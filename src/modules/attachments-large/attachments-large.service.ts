import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ActivityAction } from '@prisma/client';
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
  downloadChunkObject,
  listChunkIndices,
  uploadChunkObject,
  uploadFile,
} from '@/core/utils';
import { SettingsService } from '@/modules/settings/settings.service';
import { InitLargeUploadDto } from './dto';

type LargeUploadSession = {
  id: string;
  userId: string;
  issueId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  totalChunks: number;
  receivedChunks: Set<number>;
  bytesReceived: number;
  expiresAt: number;
};

@Injectable()
export class AttachmentsLargeService {
  private readonly logger = new Logger(AttachmentsLargeService.name);

  // In-memory session map. A single BE instance is fine for this codebase;
  // if the app ever runs multiple replicas, swap this for Redis (same key
  // namespace + TTL) without changing the public surface.
  private readonly sessions = new Map<string, LargeUploadSession>();

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  async init(userId: string, dto: InitLargeUploadDto) {
    const limits = UPLOAD_LIMITS.LARGE_ATTACHMENT;

    if (!isAllowedMime(limits, dto.mimeType)) {
      throw new BadRequestException('File type not allowed');
    }
    if (dto.fileSize > limits.maxSize) {
      throw new BadRequestException(MSG.ERROR.LARGE_UPLOAD_TOO_LARGE);
    }
    // Caller must split into chunks ≤ chunkSize. We let last chunk be
    // smaller but never larger.
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

    const id = randomUUID();
    const session: LargeUploadSession = {
      id,
      userId,
      issueId: dto.issueId,
      fileName: dto.fileName,
      mimeType: dto.mimeType,
      fileSize: dto.fileSize,
      totalChunks: dto.totalChunks,
      receivedChunks: new Set(),
      bytesReceived: 0,
      expiresAt: Date.now() + limits.sessionTtlMs,
    };
    this.sessions.set(id, session);

    return {
      sessionId: id,
      chunkSize: limits.chunkSize,
      totalChunks: dto.totalChunks,
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
  }

  async receiveChunk(
    sessionId: string,
    userId: string,
    chunkIndex: number,
    file: Express.Multer.File,
  ) {
    const session = this.getOwnedSession(sessionId, userId);

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
      // Last chunk may be smaller; never larger than declared chunkSize.
      throw new BadRequestException(MSG.ERROR.LARGE_UPLOAD_SIZE_MISMATCH);
    }

    await uploadChunkObject(sessionId, chunkIndex, file.buffer);

    if (!session.receivedChunks.has(chunkIndex)) {
      session.receivedChunks.add(chunkIndex);
      session.bytesReceived += file.size;
    }

    return {
      received: session.receivedChunks.size,
      total: session.totalChunks,
      bytesReceived: session.bytesReceived,
    };
  }

  async complete(sessionId: string, userId: string) {
    const session = this.getOwnedSession(sessionId, userId);

    if (session.receivedChunks.size !== session.totalChunks) {
      throw new BadRequestException(MSG.ERROR.LARGE_UPLOAD_INCOMPLETE);
    }

    // Self-heal: list what's actually on Supabase before assembling.
    // The BE session bookkeeping is best-effort — Supabase free tier
    // occasionally returns 200 OK on upload but doesn't persist the
    // object, so `receivedChunks` can think a chunk is there when it
    // isn't. Hand the FE the missing indices in a 409 response so it
    // can re-upload only those and call `/complete` again.
    const present = new Set(await listChunkIndices(sessionId));
    const missing: number[] = [];
    for (let i = 0; i < session.totalChunks; i++) {
      if (!present.has(i)) {
        missing.push(i);
        // Keep BE state consistent: forget that we ever received this
        // chunk so the next `/chunk` call from FE actually re-uploads
        // (otherwise the `if (!receivedChunks.has(i))` guard might skip
        // bumping bytesReceived again on duplicate).
        session.receivedChunks.delete(i);
      }
    }
    if (missing.length > 0) {
      this.logger.warn(
        `Session ${sessionId} missing chunks at /complete: [${missing.join(',')}]`,
      );
      throw new ConflictException({
        message: MSG.ERROR.LARGE_UPLOAD_CHUNKS_MISSING,
        missingChunks: missing,
      });
    }

    // Assemble in memory. Bounded by LARGE_ATTACHMENT.maxSize so the peak
    // RSS is predictable. If this ever needs to grow past ~hundreds of MB,
    // switch to a streaming uploader (Supabase TUS).
    const buffers: Buffer[] = [];
    for (let i = 0; i < session.totalChunks; i++) {
      buffers.push(await downloadChunkObject(sessionId, i));
    }
    const finalBuffer = Buffer.concat(buffers);
    if (finalBuffer.byteLength !== session.fileSize) {
      // Drop the half-written upload so the user can retry cleanly.
      void deleteChunkObjects(sessionId, session.totalChunks);
      this.sessions.delete(sessionId);
      throw new BadRequestException(MSG.ERROR.LARGE_UPLOAD_SIZE_MISMATCH);
    }

    const fileUrl = await uploadFile(
      finalBuffer,
      session.fileName,
      session.mimeType,
    );

    const attachment = await this.prisma.attachment.create({
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

    await this.prisma.activity.create({
      data: {
        issueId: session.issueId,
        userId,
        action: ActivityAction.ATTACHED,
        newValue: session.fileName,
      },
    });

    // Cleanup runs after the DB writes so a Supabase blip never costs the
    // user their attachment row.
    void deleteChunkObjects(sessionId, session.totalChunks);
    this.sessions.delete(sessionId);

    return attachment;
  }

  abort(sessionId: string, userId: string): void {
    const session = this.getOwnedSession(sessionId, userId);
    void deleteChunkObjects(sessionId, session.totalChunks);
    this.sessions.delete(sessionId);
  }

  // Sweep abandoned sessions every 10 minutes. Anything past its TTL gets
  // its temp chunks deleted so we don't pay for storage forever.
  @Cron(CronExpression.EVERY_10_MINUTES)
  async sweepExpiredSessions() {
    const now = Date.now();
    const expired: LargeUploadSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.expiresAt < now) expired.push(session);
    }
    for (const session of expired) {
      this.sessions.delete(session.id);
      try {
        await deleteChunkObjects(session.id, session.totalChunks);
      } catch (err) {
        this.logger.warn(
          `Failed to cleanup expired session ${session.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  private getOwnedSession(
    sessionId: string,
    userId: string,
  ): LargeUploadSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new NotFoundException(MSG.ERROR.LARGE_UPLOAD_SESSION_NOT_FOUND);
    }
    if (session.userId !== userId) {
      throw new ForbiddenException(MSG.ERROR.INSUFFICIENT_PERMISSIONS);
    }
    if (session.expiresAt < Date.now()) {
      this.sessions.delete(sessionId);
      void deleteChunkObjects(sessionId, session.totalChunks);
      throw new NotFoundException(MSG.ERROR.LARGE_UPLOAD_SESSION_NOT_FOUND);
    }
    return session;
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
      throw new ForbiddenException(MSG.ERROR.QUOTA_STORAGE_REACHED);
    }
  }
}
