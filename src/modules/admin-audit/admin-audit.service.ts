import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/core/database/prisma.service';

export type AuditAction =
  | 'ROLE_CHANGE'
  | 'USER_DELETE'
  | 'USER_DEACTIVATE'
  | 'USER_ACTIVATE'
  | 'SESSION_REVOKE'
  | 'SESSIONS_REVOKE_ALL'
  | 'WORKSPACE_DELETE'
  | 'PROJECT_DELETE'
  | 'ATTACHMENT_DELETE'
  | 'AVATAR_UPDATE'
  | 'SETTING_UPDATE'
  | 'FLAG_CREATE'
  | 'FLAG_UPDATE'
  | 'FLAG_DELETE';

export type QueryAuditLog = {
  action?: AuditAction;
  actorId?: string;
  targetType?: string;
  cursor?: string;
  take?: number;
};

@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Fire-and-forget: writes an audit record. Never throws — an audit write
   * failure must not break the HTTP request that triggered the action.
   */
  log(
    actorId: string,
    action: AuditAction,
    params: { target?: string; targetType?: string; payload?: unknown } = {},
  ): void {
    void this.prisma.adminAuditLog
      .create({
        data: {
          actorId,
          action,
          target: params.target,
          targetType: params.targetType,
          payload: params.payload as Prisma.InputJsonValue | undefined,
        },
      })
      .catch((err) => {
        this.logger.warn(`Audit log failed: ${String(err)}`);
      });
  }

  async findAll(query: QueryAuditLog) {
    const take = query.take ?? 50;
    const where: Prisma.AdminAuditLogWhereInput = {};
    if (query.action) where.action = query.action;
    if (query.actorId) where.actorId = query.actorId;
    if (query.targetType) where.targetType = query.targetType;

    const data = await this.prisma.adminAuditLog.findMany({
      where,
      include: {
        actor: {
          select: { id: true, name: true, email: true, image: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
    });

    const hasMore = data.length > take;
    const rows = hasMore ? data.slice(0, take) : data;
    const nextCursor = hasMore ? rows[rows.length - 1].id : null;

    return { data: rows, nextCursor, hasMore };
  }
}
