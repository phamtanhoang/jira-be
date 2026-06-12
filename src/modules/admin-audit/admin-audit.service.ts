import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/core/database/prisma.service';
import { csvEscape } from '@/core/utils';
import { LoggingConfigService } from '@/modules/logging-config/logging-config.service';

export type AuditAction =
  | 'ROLE_CHANGE'
  | 'USER_DELETE'
  | 'USER_DEACTIVATE'
  | 'USER_ACTIVATE'
  | 'USERS_BULK_INVITE'
  | 'SESSION_REVOKE'
  | 'SESSIONS_REVOKE_ALL'
  | 'WORKSPACE_DELETE'
  | 'WORKSPACE_OWNER_TRANSFER'
  | 'WORKSPACE_MEMBER_ADD'
  | 'WORKSPACE_MEMBER_REMOVE'
  | 'WORKSPACE_MEMBER_ROLE_UPDATE'
  | 'PROJECT_DELETE'
  | 'PROJECT_MEMBER_ADD'
  | 'PROJECT_MEMBER_REMOVE'
  | 'PROJECT_MEMBER_ROLE_UPDATE'
  | 'ATTACHMENT_DELETE'
  | 'AVATAR_UPDATE'
  | 'SETTING_UPDATE'
  | 'FLAG_CREATE'
  | 'FLAG_UPDATE'
  | 'FLAG_DELETE'
  | 'THROTTLE_OVERRIDE_CREATE'
  | 'THROTTLE_OVERRIDE_UPDATE'
  | 'THROTTLE_OVERRIDE_DELETE'
  | 'WEBHOOK_CREATE'
  | 'WEBHOOK_UPDATE'
  | 'WEBHOOK_DELETE'
  | 'WEBHOOK_TEST'
  | 'WEBHOOK_ROTATE_SECRET';

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

  constructor(
    private prisma: PrismaService,
    private loggingConfig: LoggingConfigService,
  ) {}

  /**
   * Fire-and-forget: writes an audit record. Never throws — an audit write
   * failure must not break the HTTP request that triggered the action.
   * Skips the write entirely when the admin has disabled audit logging.
   */
  log(
    actorId: string,
    action: AuditAction,
    params: { target?: string; targetType?: string; payload?: unknown } = {},
  ): void {
    if (!this.loggingConfig.isEnabled('adminAudit')) return;
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
