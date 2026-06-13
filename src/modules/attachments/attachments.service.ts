import { ForbiddenException, Injectable } from '@nestjs/common';
import { ActivityAction } from '@prisma/client';
import { MSG, USER_SELECT_BASIC } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import {
  assertExists,
  assertProjectAccess,
  uploadFile,
  deleteFile,
  createSignedUrl,
} from '@/core/utils';
import { AdminAuditService } from '@/modules/admin-audit/admin-audit.service';
import { RealtimeEventsService } from '@/modules/events/events.service';
import { REALTIME_EVENTS } from '@/modules/events/events.types';
import { SettingsService } from '@/modules/settings/settings.service';

@Injectable()
export class AttachmentsService {
  constructor(
    private prisma: PrismaService,
    private audit: AdminAuditService,
    private settings: SettingsService,
    private realtime: RealtimeEventsService,
  ) {}

  async uploadMany(
    issueId: string,
    userId: string,
    files: Express.Multer.File[],
  ) {
    const issue = assertExists(
      await this.prisma.issue.findUnique({
        where: { id: issueId },
        include: { project: { select: { id: true, workspaceId: true } } },
      }),
      MSG.ERROR.ISSUE_NOT_FOUND,
    );

    await assertProjectAccess(
      this.prisma,
      issue.project.workspaceId,
      issue.project.id,
      userId,
    );

    // Tenant quota — total attachment storage per workspace. Computed via
    // raw SQL aggregate so we don't pull all rows. Skip when quota = 0.
    const quotas = await this.settings.getQuotas();
    if (quotas.maxStorageGB > 0) {
      const incomingBytes = files.reduce((sum, f) => sum + f.size, 0);
      const result = await this.prisma.$queryRaw<{ bytes: bigint }[]>`
        SELECT COALESCE(SUM(a."fileSize"), 0)::bigint AS "bytes"
        FROM "Attachment" a
        JOIN "Issue" i ON i."id" = a."issueId"
        JOIN "Project" p ON p."id" = i."projectId"
        WHERE p."workspaceId" = ${issue.project.workspaceId}
      `;
      const used = Number(result[0]?.bytes ?? 0);
      const limit = quotas.maxStorageGB * 1024 * 1024 * 1024;
      if (used + incomingBytes > limit) {
        throw new ForbiddenException(MSG.ERROR.QUOTA_STORAGE_REACHED);
      }
    }

    // Two-phase upload to keep storage + DB consistent. We CAN'T put
    // `uploadFile` inside a Prisma transaction (it's an external HTTP
    // call to Supabase, would hold an open DB connection for seconds).
    // So:
    //   1. Upload every file first, collecting their URLs.
    //   2. Inside `$transaction`, write all Attachment rows + the Activity
    //      log together so the audit trail can't drift from the data.
    //   3. If the DB transaction fails, best-effort cleanup of the
    //      already-uploaded objects so we don't leak orphans in storage.
    const uploaded: {
      file: Express.Multer.File;
      url: string;
    }[] = [];
    try {
      for (const file of files) {
        const url = await uploadFile(
          file.buffer,
          file.originalname,
          file.mimetype,
        );
        uploaded.push({ file, url });
      }
    } catch (err) {
      // Upload failed mid-batch — drop anything we already wrote so the
      // workspace doesn't carry an invisible orphan.
      for (const { url } of uploaded) {
        await deleteFile(url).catch(() => undefined);
      }
      throw err;
    }

    try {
      const attachments = await this.prisma.$transaction(async (tx) => {
        const rows = await Promise.all(
          uploaded.map(({ file, url }) =>
            tx.attachment.create({
              data: {
                issueId,
                uploadedById: userId,
                fileName: file.originalname,
                fileUrl: url,
                fileSize: file.size,
                mimeType: file.mimetype,
              },
              include: { uploadedBy: USER_SELECT_BASIC },
            }),
          ),
        );
        await tx.activity.create({
          data: {
            issueId,
            userId,
            action: ActivityAction.ATTACHED,
            newValue: files.map((f) => f.originalname).join(', '),
          },
        });
        return rows;
      });
      this.realtime.emit({
        type: REALTIME_EVENTS.ATTACHMENT_ADDED,
        actorId: userId,
        projectId: issue.project.id,
        issueId,
        data: { count: attachments.length },
      });
      return attachments;
    } catch (err) {
      for (const { url } of uploaded) {
        await deleteFile(url).catch(() => undefined);
      }
      throw err;
    }
  }

  async findByIssue(issueId: string, userId: string) {
    const issue = assertExists(
      await this.prisma.issue.findUnique({
        where: { id: issueId },
        include: { project: { select: { id: true, workspaceId: true } } },
      }),
      MSG.ERROR.ISSUE_NOT_FOUND,
    );

    await assertProjectAccess(
      this.prisma,
      issue.project.workspaceId,
      issue.project.id,
      userId,
    );

    const rows = await this.prisma.attachment.findMany({
      where: { issueId },
      include: { uploadedBy: USER_SELECT_BASIC },
      orderBy: { createdAt: 'desc' },
    });

    // Enrich with short-TTL signed URLs so the bucket can be switched to
    // private without FE changes — on a public bucket these still resolve.
    const enriched = await Promise.all(
      rows.map(async (r) => {
        const signedUrl = await createSignedUrl(r.fileUrl, 600);
        return { ...r, signedUrl: signedUrl ?? r.fileUrl };
      }),
    );
    return enriched;
  }

  async getSignedUrl(attachmentId: string, userId: string) {
    const attachment = assertExists(
      await this.prisma.attachment.findUnique({
        where: { id: attachmentId },
        include: {
          issue: {
            include: { project: { select: { id: true, workspaceId: true } } },
          },
        },
      }),
      MSG.ERROR.ATTACHMENT_NOT_FOUND,
    );

    await assertProjectAccess(
      this.prisma,
      attachment.issue.project.workspaceId,
      attachment.issue.project.id,
      userId,
    );

    const signedUrl = await createSignedUrl(attachment.fileUrl, 300);
    return {
      url: signedUrl ?? attachment.fileUrl,
      expiresInSec: 300,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
    };
  }

  async delete(attachmentId: string, userId: string) {
    const attachment = assertExists(
      await this.prisma.attachment.findUnique({
        where: { id: attachmentId },
        include: {
          issue: {
            select: { project: { select: { id: true, workspaceId: true } } },
          },
        },
      }),
      MSG.ERROR.ATTACHMENT_NOT_FOUND,
    );

    // Workspace-access check first — a user removed from the workspace
    // must not be able to delete attachments they previously uploaded.
    await assertProjectAccess(
      this.prisma,
      attachment.issue.project.workspaceId,
      attachment.issue.project.id,
      userId,
    );

    if (attachment.uploadedById !== userId) {
      throw new ForbiddenException(MSG.ERROR.NOT_AUTHOR);
    }

    // DB first, storage second. If the DB delete fails the row stays —
    // the user sees their attachment in the UI and can retry. The
    // previous order risked deleting the storage object then leaving an
    // undeletable orphan row pointing at a 404.
    const result = await this.prisma.attachment.delete({
      where: { id: attachmentId },
    });
    // Best-effort storage cleanup — never throw out of delete on this.
    await deleteFile(attachment.fileUrl).catch(() => undefined);

    this.audit.log(userId, 'ATTACHMENT_DELETE', {
      target: attachmentId,
      targetType: 'Attachment',
      payload: {
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        fileSize: attachment.fileSize,
        issueId: attachment.issueId,
      },
    });

    this.realtime.emit({
      type: REALTIME_EVENTS.ATTACHMENT_DELETED,
      actorId: userId,
      projectId: attachment.issue.project.id,
      issueId: attachment.issueId,
    });

    return result;
  }
}
