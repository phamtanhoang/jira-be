import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  ActivityAction,
  Prisma,
  UploadSession,
  UploadSessionStatus,
} from '@prisma/client';
import {
  MSG,
  USER_SELECT_BASIC,
  UPLOAD_LIMITS,
  isAllowedMime,
} from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import {
  assertExists,
  assertProjectAccess,
  deleteChunkObjects,
  deleteFile,
  downloadChunkObject,
  uploadChunkObject,
  uploadFile,
} from '@/core/utils';
import {
  EventLoggerService,
  EVENTS,
} from '@/modules/logs/event-logger.service';
import { SettingsService } from '@/modules/settings/settings.service';
import { InitLargeUploadDto } from './dto';

@Injectable()
export class AttachmentsLargeService {
  private readonly logger = new Logger(AttachmentsLargeService.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private events: EventLoggerService,
  ) {}

  async init(userId: string, dto: InitLargeUploadDto) {
    const limits = UPLOAD_LIMITS.LARGE_ATTACHMENT;

    if (!isAllowedMime(limits, dto.mimeType)) {
      throw new BadRequestException('File type not allowed');
    }
    if (dto.fileSize > limits.maxSize) {
      throw new BadRequestException(MSG.ERROR.LARGE_UPLOAD_TOO_LARGE);
    }
    if (dto.fileSize > dto.totalChunks * limits.chunkSize) {
      throw new BadRequestException(MSG.ERROR.LARGE_UPLOAD_SIZE_MISMATCH);
    }

    const issue = assertExists(
      await this.prisma.issue.findUnique({
        where: { id: dto.issueId },
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

    await this.assertQuota(issue.project.workspaceId, dto.fileSize);

    const session = await this.prisma.uploadSession.create({
      data: {
        userId,
        issueId: dto.issueId,
        fileName: dto.fileName,
        mimeType: dto.mimeType,
        fileSize: dto.fileSize,
        totalChunks: dto.totalChunks,
        chunkSize: limits.chunkSize,
        status: UploadSessionStatus.PENDING,
        expiresAt: new Date(Date.now() + limits.sessionTtlMs),
      },
    });

    return {
      sessionId: session.id,
      chunkSize: limits.chunkSize,
      totalChunks: dto.totalChunks,
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  async receiveChunk(
    sessionId: string,
    userId: string,
    chunkIndex: number,
    file: Express.Multer.File,
  ) {
    const session = await this.getActiveSession(sessionId, userId);

    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      throw new BadRequestException(
        MSG.ERROR.LARGE_UPLOAD_CHUNK_INDEX_OUT_OF_RANGE,
      );
    }
    if (chunkIndex >= session.totalChunks) {
      throw new BadRequestException(
        MSG.ERROR.LARGE_UPLOAD_CHUNK_INDEX_OUT_OF_RANGE,
      );
    }
    if (file.size > UPLOAD_LIMITS.LARGE_ATTACHMENT.chunkSize) {
      throw new BadRequestException(MSG.ERROR.LARGE_UPLOAD_SIZE_MISMATCH);
    }

    await uploadChunkObject(sessionId, chunkIndex, file.buffer);

    // Atomically add the chunk to the receivedChunks array if not already
    // present. We re-fetch + update because Prisma's array operations are
    // limited; the row is small so a read-modify-write is cheap.
    const updated = await this.prisma.uploadSession.update({
      where: { id: sessionId },
      data: session.receivedChunks.includes(chunkIndex)
        ? {} // no-op: chunk was already counted (idempotent retry)
        : {
            receivedChunks: { push: chunkIndex },
            bytesReceived: { increment: file.size },
          },
    });

    return {
      received: updated.receivedChunks.length,
      total: updated.totalChunks,
      bytesReceived: updated.bytesReceived,
    };
  }

  /**
   * Read-only progress probe — used by FE to resume an interrupted upload
   * after page reload. Returns the same shape as `receiveChunk` plus the
   * indices already on storage so FE can skip them.
   */
  async getStatus(sessionId: string, userId: string) {
    const session = await this.getActiveSession(sessionId, userId);
    return {
      sessionId: session.id,
      issueId: session.issueId,
      fileName: session.fileName,
      fileSize: session.fileSize,
      mimeType: session.mimeType,
      totalChunks: session.totalChunks,
      chunkSize: session.chunkSize,
      receivedChunks: [...session.receivedChunks].sort((a, b) => a - b),
      bytesReceived: session.bytesReceived,
      status: session.status,
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  async complete(sessionId: string, userId: string) {
    // Mark the session COMPLETING in a conditional update — only the row
    // currently in PENDING flips, so a concurrent /complete call sees no
    // matching row and bails with NotFound. This is our atomic mutex
    // against duplicate Attachment rows.
    const claim = await this.prisma.uploadSession.updateMany({
      where: {
        id: sessionId,
        userId,
        status: UploadSessionStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
      data: { status: UploadSessionStatus.COMPLETING },
    });
    if (claim.count === 0) {
      // Either the session never existed, has been claimed by another
      // /complete, was already finished, or expired. Distinguish so the
      // FE can either show "already done" (return cached attachment) or
      // "not found" (start over).
      const session = await this.prisma.uploadSession.findUnique({
        where: { id: sessionId },
      });
      if (!session || session.userId !== userId) {
        throw new NotFoundException(MSG.ERROR.LARGE_UPLOAD_SESSION_NOT_FOUND);
      }
      if (
        session.status === UploadSessionStatus.COMPLETED &&
        session.attachmentId
      ) {
        const attachment = await this.prisma.attachment.findUnique({
          where: { id: session.attachmentId },
          include: { uploadedBy: USER_SELECT_BASIC },
        });
        if (attachment) return attachment;
      }
      if (session.status === UploadSessionStatus.COMPLETING) {
        throw new ConflictException(MSG.ERROR.LARGE_UPLOAD_IN_PROGRESS);
      }
      throw new NotFoundException(MSG.ERROR.LARGE_UPLOAD_SESSION_NOT_FOUND);
    }

    const session = await this.prisma.uploadSession.findUniqueOrThrow({
      where: { id: sessionId },
    });

    try {
      return await this.assembleAndPersist(session, userId);
    } catch (err) {
      // ConflictException carries `missingChunks` — FE will re-upload and
      // call /complete again, so we need the session usable for retry.
      // Move it back to PENDING.
      if (err instanceof ConflictException) {
        await this.prisma.uploadSession.update({
          where: { id: sessionId },
          data: { status: UploadSessionStatus.PENDING },
        });
        throw err;
      }
      // Any other failure is terminal for this session — mark FAILED so
      // the cron sweep eventually cleans temp chunks. We do NOT auto-
      // delete chunks here: a retry from FE might still recover.
      await this.prisma.uploadSession.update({
        where: { id: sessionId },
        data: { status: UploadSessionStatus.FAILED },
      });
      throw err;
    }
  }

  abort(sessionId: string, userId: string): Promise<void> {
    return this.abortInternal(sessionId, userId);
  }

  /**
   * Same as `abort` but tolerates "already gone" — used by the
   * `navigator.sendBeacon` cleanup that fires from the browser as the
   * tab is being torn down, where retries aren't possible.
   */
  async abortBeacon(sessionId: string, userId: string): Promise<void> {
    try {
      await this.abortInternal(sessionId, userId);
    } catch (err) {
      // Beacon path: swallow NotFound (session already cleaned) so the
      // browser doesn't keep retrying. Log anything weirder.
      if (!(err instanceof NotFoundException)) {
        this.logger.warn(
          `Beacon abort for ${sessionId} hit unexpected error: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  private async abortInternal(
    sessionId: string,
    userId: string,
  ): Promise<void> {
    const session = await this.prisma.uploadSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException(MSG.ERROR.LARGE_UPLOAD_SESSION_NOT_FOUND);
    }
    if (session.userId !== userId) {
      throw new ForbiddenException(MSG.ERROR.INSUFFICIENT_PERMISSIONS);
    }
    if (
      session.status === UploadSessionStatus.COMPLETED ||
      session.status === UploadSessionStatus.ABORTED
    ) {
      // Idempotent — already finished one way or another.
      return;
    }
    await this.prisma.uploadSession.update({
      where: { id: sessionId },
      data: { status: UploadSessionStatus.ABORTED },
    });
    void deleteChunkObjects(sessionId, session.totalChunks);
  }

  // Sweep every 30 minutes — Neon free-tier compute charges by the hour,
  // so a 5-min cron alone keeps the DB warm 24/7 even when no users are
  // active. 30 min is still way under the 1-hour session TTL — orphaned
  // uploads still get cleaned promptly, but the DB gets long idle windows.
  @Cron(CronExpression.EVERY_30_MINUTES)
  async sweepExpiredSessions() {
    const now = new Date();
    const expired = await this.prisma.uploadSession.findMany({
      where: {
        expiresAt: { lt: now },
        status: {
          in: [UploadSessionStatus.PENDING, UploadSessionStatus.FAILED],
        },
      },
      select: { id: true, totalChunks: true },
      take: 100,
    });
    for (const session of expired) {
      try {
        await deleteChunkObjects(session.id, session.totalChunks);
      } catch (err) {
        this.logger.warn(
          `Sweep chunk cleanup failed for ${session.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    if (expired.length > 0) {
      await this.prisma.uploadSession.updateMany({
        where: { id: { in: expired.map((s) => s.id) } },
        data: { status: UploadSessionStatus.ABORTED },
      });
      this.logger.log(`Sweep aborted ${expired.length} expired session(s).`);
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private async getActiveSession(
    sessionId: string,
    userId: string,
  ): Promise<UploadSession> {
    const session = await this.prisma.uploadSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException(MSG.ERROR.LARGE_UPLOAD_SESSION_NOT_FOUND);
    }
    if (session.userId !== userId) {
      throw new ForbiddenException(MSG.ERROR.INSUFFICIENT_PERMISSIONS);
    }
    if (session.expiresAt < new Date()) {
      // Lazy expire — mark and bail. Cron will pick up the chunk cleanup.
      await this.prisma.uploadSession.update({
        where: { id: sessionId },
        data: { status: UploadSessionStatus.ABORTED },
      });
      throw new NotFoundException(MSG.ERROR.LARGE_UPLOAD_SESSION_NOT_FOUND);
    }
    if (
      session.status === UploadSessionStatus.ABORTED ||
      session.status === UploadSessionStatus.FAILED
    ) {
      throw new NotFoundException(MSG.ERROR.LARGE_UPLOAD_SESSION_NOT_FOUND);
    }
    if (session.status === UploadSessionStatus.COMPLETED) {
      throw new ConflictException(MSG.ERROR.LARGE_UPLOAD_ALREADY_COMPLETED);
    }
    return session;
  }

  /**
   * Verify every chunk is downloadable, assemble the final file, persist
   * it to storage, then write the Attachment + Activity rows in a single
   * Prisma transaction. If the DB transaction fails AFTER the final file
   * has been uploaded, we best-effort delete the final file so we don't
   * leak storage. On chunk-download failure (Supabase consistency lag)
   * we throw a 409 with the missing indices so the FE can re-upload.
   */
  private async assembleAndPersist(session: UploadSession, userId: string) {
    // Download all chunks. On any download failure → ask FE for re-upload.
    const buffers: Buffer[] = [];
    for (let i = 0; i < session.totalChunks; i++) {
      try {
        buffers.push(await downloadChunkObject(session.id, i));
      } catch (err) {
        this.logger.warn(
          `Session ${session.id} download failed for chunk ${i}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        // Forget this chunk in the bookkeeping so /chunk re-upload counts again.
        await this.prisma.uploadSession.update({
          where: { id: session.id },
          data: {
            receivedChunks: session.receivedChunks.filter((c) => c !== i),
            bytesReceived: { decrement: session.chunkSize },
          },
        });
        throw new ConflictException({
          message: MSG.ERROR.LARGE_UPLOAD_CHUNKS_MISSING,
          missingChunks: [i],
        });
      }
    }
    const finalBuffer = Buffer.concat(buffers);
    if (finalBuffer.byteLength !== session.fileSize) {
      throw new BadRequestException(MSG.ERROR.LARGE_UPLOAD_SIZE_MISMATCH);
    }

    // Upload the assembled file to its permanent storage path. From here
    // until the DB transaction commits, a failure means we need to delete
    // this file to avoid leaking storage.
    const fileUrl = await uploadFile(
      finalBuffer,
      session.fileName,
      session.mimeType,
    );

    let attachment: Prisma.AttachmentGetPayload<{
      include: { uploadedBy: typeof USER_SELECT_BASIC };
    }>;
    try {
      attachment = await this.prisma.$transaction(async (tx) => {
        const created = await tx.attachment.create({
          data: {
            issueId: session.issueId,
            uploadedById: userId,
            fileName: session.fileName,
            fileUrl,
            fileSize: session.fileSize,
            mimeType: session.mimeType,
          },
          include: { uploadedBy: USER_SELECT_BASIC },
        });
        await tx.activity.create({
          data: {
            issueId: session.issueId,
            userId,
            action: ActivityAction.ATTACHED,
            newValue: session.fileName,
          },
        });
        await tx.uploadSession.update({
          where: { id: session.id },
          data: {
            status: UploadSessionStatus.COMPLETED,
            attachmentId: created.id,
          },
        });
        return created;
      });
    } catch (err) {
      // DB write failed — undo the storage upload so we don't leak.
      void deleteFile(fileUrl);
      throw err;
    }

    // Cleanup temp chunks. Fire-and-forget — leaked temp chunks are
    // wasted storage, not a data bug; the cron sweep will catch any
    // straggler too.
    void deleteChunkObjects(session.id, session.totalChunks);

    return attachment;
  }

  private async assertQuota(workspaceId: string, incomingBytes: number) {
    const quotas = await this.settings.getQuotas();
    if (quotas.maxStorageGB <= 0) return;
    const result = await this.prisma.$queryRaw<{ bytes: bigint }[]>`
      SELECT COALESCE(SUM(a."fileSize"), 0)::bigint AS "bytes"
      FROM "Attachment" a
      JOIN "Issue" i ON i."id" = a."issueId"
      JOIN "Project" p ON p."id" = i."projectId"
      WHERE p."workspaceId" = ${workspaceId}
    `;
    const used = Number(result[0]?.bytes ?? 0);
    const limit = quotas.maxStorageGB * 1024 * 1024 * 1024;
    if (used + incomingBytes > limit) {
      this.events.log(EVENTS.QUOTA_EXCEEDED, {
        metadata: {
          quota: 'storage',
          workspaceId,
          limitBytes: limit,
          usedBytes: used,
          requestedBytes: incomingBytes,
        },
      });
      throw new ForbiddenException(MSG.ERROR.QUOTA_STORAGE_REACHED);
    }
  }
}
