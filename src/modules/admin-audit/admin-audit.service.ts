import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/core/database/prisma.service';
import { csvEscape } from '@/core/utils';

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
  page?: number;
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
    const page = Math.max(1, query.page ?? 1);
    const where: Prisma.AdminAuditLogWhereInput = {};
    if (query.action) where.action = query.action;
    if (query.actorId) where.actorId = query.actorId;
    if (query.targetType) where.targetType = query.targetType;

    const [total, data] = await this.prisma.$transaction([
      this.prisma.adminAuditLog.count({ where }),
      this.prisma.adminAuditLog.findMany({
        where,
        include: {
          actor: {
            select: { id: true, name: true, email: true, image: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip: (page - 1) * take,
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / take));
    return {
      data,
      total,
      page,
      pageSize: take,
      totalPages,
      hasMore: page < totalPages,
      nextCursor: null,
    };
  }

  /**
   * Export the (filtered) audit log as a CSV blob. Same `where` clause as
   * `findAll` so the export honors whatever filters the admin has applied.
   * No pagination — admins can request a date-bounded export when the table
   * gets large; for now we cap at 10k rows to bound memory.
   */
  async exportCsv(query: QueryAuditLog): Promise<string> {
    const where: Prisma.AdminAuditLogWhereInput = {};
    if (query.action) where.action = query.action;
    if (query.actorId) where.actorId = query.actorId;
    if (query.targetType) where.targetType = query.targetType;

    const rows = await this.prisma.adminAuditLog.findMany({
      where,
      include: {
        actor: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10_000,
    });

    const headers = [
      'Time',
      'Actor',
      'ActorEmail',
      'Action',
      'Target',
      'TargetType',
      'Payload',
    ];

    const lines = [
      headers.join(','),
      ...rows.map((r) =>
        [
          r.createdAt.toISOString(),
          r.actor?.name ?? '',
          r.actor?.email ?? '',
          r.action,
          r.target ?? '',
          r.targetType ?? '',
          r.payload ?? '',
        ]
          .map((v) => csvEscape(v))
          .join(','),
      ),
    ];

    return lines.join('\n');
  }
}
