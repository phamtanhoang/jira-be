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
import { SettingsService } from '@/modules/settings/settings.service';

@Injectable()
export class AttachmentsService {
  constructor(
    private prisma: PrismaService,
    private audit: AdminAuditService,
    private settings: SettingsService,
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

    const attachments: Awaited<
      ReturnType<typeof this.prisma.attachment.create>
    >[] = [];

    for (const file of files) {
      const fileUrl: string = await uploadFile(
        file.buffer,
        file.originalname,
        file.mimetype,
      );

      const attachment = await this.prisma.attachment.create({
        data: {
          issueId,
          uploadedById: userId,
          fileName: file.originalname,
          fileUrl,
          fileSize: file.size,
          mimeType: file.mimetype,
        },
        include: { uploadedBy: USER_SELECT_BASIC },
      });

      attachments.push(attachment);
    }

    // Log single activity for batch upload
    const fileNames = files.map((f) => f.originalname).join(', ');
    await this.prisma.activity.create({
      data: {
        issueId,
        userId,
        action: ActivityAction.ATTACHED,
        newValue: fileNames,
      },
    });

    return attachments;
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
      }),
      MSG.ERROR.ATTACHMENT_NOT_FOUND,
    );

    if (attachment.uploadedById !== userId) {
      throw new ForbiddenException(MSG.ERROR.NOT_AUTHOR);
    }

    await deleteFile(attachment.fileUrl);

    const result = await this.prisma.attachment.delete({
      where: { id: attachmentId },
    });
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
    return result;
  }
}
