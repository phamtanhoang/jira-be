import { Injectable, NotFoundException } from '@nestjs/common';
import { LogLevel, Prisma } from '@prisma/client';
import { ENV, MSG, USER_SELECT_BASIC } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { MailService } from '@/core/mail/mail.service';
import { AdminAuditService } from '@/modules/admin-audit/admin-audit.service';
import { QueryAdminWorkspacesDto } from './dto';

type LogLevelCounts = Record<LogLevel, number>;

type DailyCountRow = { date: Date; count: bigint };
type DailyLogRow = {
  date: Date;
  level: LogLevel;
  count: bigint;
};
type RouteMetricRow = {
  route: string | null;
  count: bigint;
  errorcount: bigint;
  p50: number | null;
  p95: number | null;
  p99: number | null;
};
type SlowestRow = {
  id: string;
  url: string;
  method: string;
  statusCode: number | null;
  durationMs: number | null;
  userEmail: string | null;
  createdAt: Date;
};
type HourlyErrorRow = { bucket: Date; count: bigint };

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private audit: AdminAuditService,
    private mail: MailService,
  ) {}

  async getStats() {
    const now = new Date();
    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      usersTotal,
      usersAdmins,
      usersNew7d,
      usersUnverified,
      workspacesTotal,
      projectsTotal,
      issuesTotal,
      logsGrouped,
      recentSignups,
      topWorkspacesPool,
      activeUsers24hRaw,
    ] = await this.prisma.$transaction([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { role: 'ADMIN' } }),
      this.prisma.user.count({ where: { createdAt: { gte: since7d } } }),
      this.prisma.user.count({ where: { emailVerified: null } }),
      this.prisma.workspace.count(),
      this.prisma.project.count(),
      this.prisma.issue.count(),
      this.prisma.requestLog.groupBy({
        by: ['level'],
        where: { createdAt: { gte: since24h } },
        _count: { level: true },
        orderBy: { level: 'asc' },
      }),
      this.prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          createdAt: true,
        },
      }),
      this.prisma.workspace.findMany({
        take: 20,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          slug: true,
          owner: USER_SELECT_BASIC,
          _count: { select: { projects: true, members: true } },
        },
      }),
      this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(DISTINCT "userId")::bigint AS "count"
        FROM "RequestLog"
        WHERE "createdAt" >= ${since24h}
          AND "userId" IS NOT NULL
      `,
    ]);

    const logs: LogLevelCounts = { INFO: 0, WARN: 0, ERROR: 0 };
    for (const row of logsGrouped) {
      const count = row._count as { level?: number } | undefined;
      logs[row.level] = count?.level ?? 0;
    }

    // Top 3 by (projects + members). Sorting 20 rows in memory keeps the
    // query simple without a custom groupBy/raw-sql aggregation.
    const topWorkspaces = [...topWorkspacesPool]
      .sort(
        (a, b) =>
          b._count.projects +
          b._count.members -
          (a._count.projects + a._count.members),
      )
      .slice(0, 3);

    return {
      users: {
        total: usersTotal,
        admins: usersAdmins,
        newLast7Days: usersNew7d,
        unverified: usersUnverified,
      },
      workspaces: { total: workspacesTotal },
      projects: { total: projectsTotal },
      issues: { total: issuesTotal },
      logs: { last24h: logs },
      recentSignups,
      topWorkspaces,
      activeUsers24h: Number(activeUsers24hRaw[0]?.count ?? 0),
    };
  }

  /**
   * Daily counts over the past N days for signups, issues, workspaces, and
   * request-log-by-level. Gaps (days with zero rows) are filled so the chart
   * shows a continuous timeline.
   */
  async getAnalytics(days = 14) {
    const now = new Date();
    // Start of "today - (days-1)" so days=14 returns 14 buckets up to today.
    const since = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
    since.setUTCHours(0, 0, 0, 0);

    const [
      signupsRaw,
      issuesRaw,
      workspacesRaw,
      commentsRaw,
      worklogsRaw,
      activeUsersRaw,
      logsRaw,
    ] = await Promise.all([
      this.prisma.$queryRaw<DailyCountRow[]>`
        SELECT DATE_TRUNC('day', "createdAt") AS "date",
               COUNT(*)::bigint AS "count"
        FROM "User"
        WHERE "createdAt" >= ${since}
        GROUP BY DATE_TRUNC('day', "createdAt")
        ORDER BY "date" ASC
      `,
      this.prisma.$queryRaw<DailyCountRow[]>`
        SELECT DATE_TRUNC('day', "createdAt") AS "date",
               COUNT(*)::bigint AS "count"
        FROM "Issue"
        WHERE "createdAt" >= ${since}
        GROUP BY DATE_TRUNC('day', "createdAt")
        ORDER BY "date" ASC
      `,
      this.prisma.$queryRaw<DailyCountRow[]>`
        SELECT DATE_TRUNC('day', "createdAt") AS "date",
               COUNT(*)::bigint AS "count"
        FROM "Workspace"
        WHERE "createdAt" >= ${since}
        GROUP BY DATE_TRUNC('day', "createdAt")
        ORDER BY "date" ASC
      `,
      this.prisma.$queryRaw<DailyCountRow[]>`
        SELECT DATE_TRUNC('day', "createdAt") AS "date",
               COUNT(*)::bigint AS "count"
        FROM "Comment"
        WHERE "createdAt" >= ${since}
        GROUP BY DATE_TRUNC('day', "createdAt")
        ORDER BY "date" ASC
      `,
      this.prisma.$queryRaw<DailyCountRow[]>`
        SELECT DATE_TRUNC('day', "createdAt") AS "date",
               COUNT(*)::bigint AS "count"
        FROM "Worklog"
        WHERE "createdAt" >= ${since}
        GROUP BY DATE_TRUNC('day', "createdAt")
        ORDER BY "date" ASC
      `,
      this.prisma.$queryRaw<DailyCountRow[]>`
        SELECT DATE_TRUNC('day', "createdAt") AS "date",
               COUNT(DISTINCT "userId")::bigint AS "count"
        FROM "RequestLog"
        WHERE "createdAt" >= ${since}
          AND "userId" IS NOT NULL
        GROUP BY DATE_TRUNC('day', "createdAt")
        ORDER BY "date" ASC
      `,
      this.prisma.$queryRaw<DailyLogRow[]>`
        SELECT DATE_TRUNC('day', "createdAt") AS "date",
               "level",
               COUNT(*)::bigint AS "count"
        FROM "RequestLog"
        WHERE "createdAt" >= ${since}
        GROUP BY DATE_TRUNC('day', "createdAt"), "level"
        ORDER BY "date" ASC
      `,
    ]);

    const bucketKeys: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
      bucketKeys.push(d.toISOString().slice(0, 10));
    }

    const simpleBuckets = (rows: DailyCountRow[]) => {
      const map = new Map<string, number>();
      for (const r of rows) {
        map.set(r.date.toISOString().slice(0, 10), Number(r.count));
      }
      return bucketKeys.map((date) => ({
        date,
        count: map.get(date) ?? 0,
      }));
    };

    const logBuckets = () => {
      const map = new Map<string, LogLevelCounts>();
      for (const r of logsRaw) {
        const key = r.date.toISOString().slice(0, 10);
        const entry =
          map.get(key) ?? ({ INFO: 0, WARN: 0, ERROR: 0 } as LogLevelCounts);
        entry[r.level] = Number(r.count);
        map.set(key, entry);
      }
      return bucketKeys.map((date) => ({
        date,
        INFO: map.get(date)?.INFO ?? 0,
        WARN: map.get(date)?.WARN ?? 0,
        ERROR: map.get(date)?.ERROR ?? 0,
      }));
    };

    return {
      days,
      signups: simpleBuckets(signupsRaw),
      issuesCreated: simpleBuckets(issuesRaw),
      newWorkspaces: simpleBuckets(workspacesRaw),
      comments: simpleBuckets(commentsRaw),
      worklogs: simpleBuckets(worklogsRaw),
      activeUsers: simpleBuckets(activeUsersRaw),
      requestsByLevel: logBuckets(),
    };
  }

  /**
   * Performance hotspots for the past N hours: top-10 routes by request
   * count with p50/p95/p99 latency + error count, plus method/status
   * distributions.
   */
  async getMetrics(sinceHours = 24, take = 10) {
    const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
    // Clamp: bigger pages just slow down the percentile rollup without adding
    // value to the UI.
    const limit = Math.min(Math.max(take, 1), 100);

    const [topRoutesRaw, methodsRaw, statusesRaw, slowestRaw, errorTrendRaw] =
      await Promise.all([
        this.prisma.$queryRaw<RouteMetricRow[]>`
        SELECT "route",
               COUNT(*)::bigint AS "count",
               COUNT(*) FILTER (WHERE "statusCode" >= 500)::bigint AS "errorcount",
               PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "durationMs"::double precision) AS "p50",
               PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "durationMs"::double precision) AS "p95",
               PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY "durationMs"::double precision) AS "p99"
        FROM "RequestLog"
        WHERE "createdAt" >= ${since}
          AND "route" IS NOT NULL
        GROUP BY "route"
        ORDER BY "count" DESC
        LIMIT ${limit}
      `,
        this.prisma.requestLog.groupBy({
          by: ['method'],
          where: { createdAt: { gte: since } },
          _count: { method: true },
          orderBy: { _count: { method: 'desc' } },
        }),
        this.prisma.requestLog.groupBy({
          by: ['statusCode'],
          where: { createdAt: { gte: since }, statusCode: { not: null } },
          _count: { statusCode: true },
          orderBy: { statusCode: 'asc' },
        }),
        this.prisma.$queryRaw<SlowestRow[]>`
        SELECT "id", "url", "method", "statusCode", "durationMs",
               "userEmail", "createdAt"
        FROM "RequestLog"
        WHERE "createdAt" >= ${since}
          AND "durationMs" IS NOT NULL
        ORDER BY "durationMs" DESC NULLS LAST
        LIMIT ${limit}
      `,
        this.prisma.$queryRaw<HourlyErrorRow[]>`
        SELECT DATE_TRUNC('hour', "createdAt") AS "bucket",
               COUNT(*)::bigint AS "count"
        FROM "RequestLog"
        WHERE "createdAt" >= ${since}
          AND "statusCode" >= 500
        GROUP BY DATE_TRUNC('hour', "createdAt")
        ORDER BY "bucket" ASC
      `,
      ]);

    return {
      sinceHours,
      topRoutes: topRoutesRaw.map((r) => ({
        route: r.route ?? '(unknown)',
        count: Number(r.count),
        errorCount: Number(r.errorcount),
        p50: r.p50 === null ? 0 : Math.round(r.p50),
        p95: r.p95 === null ? 0 : Math.round(r.p95),
        p99: r.p99 === null ? 0 : Math.round(r.p99),
      })),
      methodDistribution: methodsRaw.map((r) => {
        const c = r._count as { method?: number } | undefined;
        return { method: r.method, count: c?.method ?? 0 };
      }),
      statusDistribution: statusesRaw.map((r) => {
        const c = r._count as { statusCode?: number } | undefined;
        return { statusCode: r.statusCode ?? 0, count: c?.statusCode ?? 0 };
      }),
      slowestRequests: slowestRaw.map((r) => ({
        id: r.id,
        url: r.url,
        method: r.method,
        statusCode: r.statusCode,
        durationMs: r.durationMs ?? 0,
        userEmail: r.userEmail,
        createdAt: r.createdAt,
      })),
      errorTrendHourly: errorTrendRaw.map((r) => ({
        bucket: r.bucket.toISOString(),
        count: Number(r.count),
      })),
    };
  }

  /**
   * Aggregate user activity from RequestLog, excluding admin-origin traffic.
   * Gives admins a read on what end-users actually do in the app.
   */
  async getUserActivity(sinceHours = 168, take = 30) {
    const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
    // Top* lists max out smaller than recent — they're aggregations, not a
    // feed, so 50 is plenty even at "load more" max.
    const recentLimit = Math.min(Math.max(take, 1), 200);
    const topLimit = Math.min(Math.max(take, 15), 50);

    // Base filter: skip null users (unauthenticated probes) and admin routes
    const baseWhere: Prisma.RequestLogWhereInput = {
      createdAt: { gte: since },
      userId: { not: null },
      NOT: [{ url: { startsWith: '/admin' } }],
    };

    const [topUsers, topRoutes, recent, totals] = await Promise.all([
      // Top active users by request volume
      this.prisma.requestLog.groupBy({
        by: ['userId', 'userEmail'],
        where: baseWhere,
        _count: { _all: true },
        _max: { createdAt: true },
        orderBy: { _count: { userId: 'desc' } },
        take: topLimit,
      }),
      // Top-used app endpoints
      this.prisma.requestLog.groupBy({
        by: ['route', 'method'],
        where: { ...baseWhere, route: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { route: 'desc' } },
        take: topLimit,
      }),
      // Most recent app actions across all users (for an activity feed)
      this.prisma.requestLog.findMany({
        where: baseWhere,
        select: {
          id: true,
          method: true,
          url: true,
          route: true,
          statusCode: true,
          userEmail: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: recentLimit,
      }),
      this.prisma.requestLog.aggregate({
        where: baseWhere,
        _count: { _all: true },
      }),
    ]);

    return {
      sinceHours,
      totalRequests: totals._count._all,
      topUsers: topUsers.map((u) => ({
        userId: u.userId,
        userEmail: u.userEmail,
        count: u._count._all,
        lastSeen: u._max.createdAt?.toISOString() ?? null,
      })),
      topRoutes: topRoutes.map((r) => ({
        route: r.route,
        method: r.method,
        count: r._count._all,
      })),
      recent: recent.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async listAllWorkspaces(query: QueryAdminWorkspacesDto) {
    const take = query.take ?? 50;
    const where: Prisma.WorkspaceWhereInput = {};
    if (query.search) {
      where.OR = [
        {
          name: {
            contains: query.search,
            mode: Prisma.QueryMode.insensitive,
          },
        },
        {
          slug: {
            contains: query.search,
            mode: Prisma.QueryMode.insensitive,
          },
        },
      ];
    }

    const data = await this.prisma.workspace.findMany({
      where,
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        owner: USER_SELECT_BASIC,
        _count: { select: { projects: true, members: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
    });

    const hasMore = data.length > take;
    const rows = hasMore ? data.slice(0, take) : data;
    const nextCursor = hasMore ? rows[rows.length - 1].id : null;

    // Bulk-aggregate attachment storage per workspace. Single grouped query
    // beats N+1 detail lookups when the page shows 50 workspaces.
    const storageRows =
      rows.length === 0
        ? []
        : await this.prisma.$queryRaw<{ workspaceId: string; bytes: bigint }[]>`
            SELECT p."workspaceId", COALESCE(SUM(a."fileSize"), 0)::bigint AS "bytes"
            FROM "Attachment" a
            JOIN "Issue" i ON i."id" = a."issueId"
            JOIN "Project" p ON p."id" = i."projectId"
            WHERE p."workspaceId" IN (${Prisma.join(rows.map((r) => r.id))})
            GROUP BY p."workspaceId"
          `;
    const storageByWs = new Map(
      storageRows.map((r) => [r.workspaceId, Number(r.bytes)]),
    );

    const enriched = rows.map((r) => ({
      ...r,
      storageBytes: storageByWs.get(r.id) ?? 0,
    }));

    return { data: enriched, nextCursor, hasMore };
  }

  async deleteWorkspace(id: string, actorId: string) {
    const exists = await this.prisma.workspace.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!exists) throw new NotFoundException(MSG.ERROR.WORKSPACE_NOT_FOUND);
    await this.prisma.workspace.delete({ where: { id } });
    this.audit.log(actorId, 'WORKSPACE_DELETE', {
      target: id,
      targetType: 'Workspace',
      payload: { name: exists.name },
    });
    return { message: MSG.SUCCESS.WORKSPACE_DELETED };
  }

  // System health probe — surfaces wiring status of external dependencies +
  // process metrics so admins can spot a degraded service before users do.
  // Each probe wraps in try/catch so one failure doesn't fail the whole call.
  async getHealth() {
    const startedAt = Date.now();

    const dbProbe = async (): Promise<{
      ok: boolean;
      latencyMs: number;
      error?: string;
    }> => {
      const t = Date.now();
      try {
        await this.prisma.$queryRaw`SELECT 1`;
        return { ok: true, latencyMs: Date.now() - t };
      } catch (err) {
        return { ok: false, latencyMs: Date.now() - t, error: String(err) };
      }
    };

    const supabaseProbe = async (): Promise<{
      configured: boolean;
      ok: boolean;
      error?: string;
    }> => {
      if (!ENV.SUPABASE_URL || !ENV.SUPABASE_SERVICE_KEY) {
        return { configured: false, ok: false };
      }
      try {
        const res = await fetch(`${ENV.SUPABASE_URL}/auth/v1/health`, {
          headers: { apikey: ENV.SUPABASE_SERVICE_KEY },
          signal: AbortSignal.timeout(3000),
        });
        return { configured: true, ok: res.ok };
      } catch (err) {
        return { configured: true, ok: false, error: String(err) };
      }
    };

    const [db, supabase] = await Promise.all([dbProbe(), supabaseProbe()]);

    const mem = process.memoryUsage();
    const memoryMB = Math.round((mem.rss / 1024 / 1024) * 10) / 10;

    return {
      checkedAt: new Date().toISOString(),
      checkDurationMs: Date.now() - startedAt,
      db,
      // Resend has no cheap public health endpoint — report config-only state.
      mail: {
        configured: !!ENV.RESEND_API_KEY,
        from: ENV.MAIL_FROM || null,
      },
      supabase,
      sentry: {
        configured: !!ENV.SENTRY_DSN,
        active: !!ENV.SENTRY_DSN && ENV.IS_PRODUCTION,
      },
      runtime: {
        nodeVersion: process.version,
        uptimeSec: Math.round(process.uptime()),
        memoryMB,
        env: ENV.NODE_ENV,
      },
    };
  }

  // Detail view of a single workspace for /admin/workspaces/:id. Bundles
  // counts + recent activity so the FE doesn't need to chain 5 calls.
  async getWorkspaceById(id: string) {
    const ws = await this.prisma.workspace.findUnique({
      where: { id },
      include: {
        owner: USER_SELECT_BASIC,
        _count: { select: { members: true, projects: true } },
      },
    });
    if (!ws) throw new NotFoundException(MSG.ERROR.WORKSPACE_NOT_FOUND);

    const projectIdRows = await this.prisma.project.findMany({
      where: { workspaceId: id },
      select: { id: true },
    });
    const projectIds = projectIdRows.map((p) => p.id);

    const [
      issuesTotal,
      issuesOpen,
      attachmentsAgg,
      recentProjects,
      recentMembers,
    ] = await Promise.all([
      this.prisma.issue.count({ where: { projectId: { in: projectIds } } }),
      this.prisma.issue.count({
        where: {
          projectId: { in: projectIds },
          boardColumn: { category: { not: 'DONE' } },
        },
      }),
      this.prisma.attachment.aggregate({
        where: { issue: { projectId: { in: projectIds } } },
        _sum: { fileSize: true },
        _count: { _all: true },
      }),
      this.prisma.project.findMany({
        where: { workspaceId: id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          name: true,
          key: true,
          createdAt: true,
          _count: { select: { issues: true } },
        },
      }),
      this.prisma.workspaceMember.findMany({
        where: { workspaceId: id },
        orderBy: { joinedAt: 'desc' },
        take: 10,
        include: { user: USER_SELECT_BASIC },
      }),
    ]);

    return {
      id: ws.id,
      name: ws.name,
      slug: ws.slug,
      description: ws.description,
      createdAt: ws.createdAt,
      owner: ws.owner,
      counts: {
        members: ws._count.members,
        projects: ws._count.projects,
        issues: issuesTotal,
        issuesOpen,
        attachments: attachmentsAgg._count._all,
      },
      storage: {
        bytes: Number(attachmentsAgg._sum.fileSize ?? 0),
      },
      recentProjects,
      recentMembers,
    };
  }

  // Bulk-invite by email — does NOT pre-create User rows. Each new email
  // gets an invitation email linking to /sign-up?email=...; existing users
  // are reported back as `skipped`. The mail send is fire-and-forget so a
  // single SMTP failure doesn't block the whole batch.
  async bulkInviteUsers(actorId: string, emails: string[], message?: string) {
    const cleaned = Array.from(
      new Set(
        emails
          .map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
          .filter((e) => e.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)),
      ),
    );
    const invalid = emails.length - cleaned.length;

    if (cleaned.length === 0) {
      return {
        message: MSG.SUCCESS.USERS_BULK_INVITED,
        invited: 0,
        skipped: 0,
        invalid,
      };
    }

    const existing = await this.prisma.user.findMany({
      where: { email: { in: cleaned } },
      select: { email: true },
    });
    const existingSet = new Set(existing.map((u) => u.email.toLowerCase()));
    const fresh = cleaned.filter((e) => !existingSet.has(e));

    this.audit.log(actorId, 'USERS_BULK_INVITE', {
      target: 'bulk-invite',
      targetType: 'User',
      payload: {
        invited: fresh.length,
        skipped: existingSet.size,
        invalid,
        ...(message ? { message } : {}),
      },
    });

    // Fan out the actual mail sends — fire-and-forget so a single SMTP
    // failure doesn't cascade. Each call already persists a MailLog row, so
    // operators can audit failures from /admin/mail-logs.
    const signUpBase = ENV.FRONTEND_URL || ENV.CORS_ORIGIN.split(',')[0] || '';
    for (const email of fresh) {
      const link = `${signUpBase}/sign-up?email=${encodeURIComponent(email)}`;
      const html = renderInvitationHtml(link, message);
      void this.mail
        .send({
          to: email,
          subject: 'You have been invited',
          html,
          type: 'OTHER',
        })
        .catch(() => null);
    }

    return {
      message: MSG.SUCCESS.USERS_BULK_INVITED,
      invited: fresh.length,
      skipped: existingSet.size,
      invalid,
    };
  }
}

function renderInvitationHtml(
  signUpUrl: string,
  customMessage?: string,
): string {
  const safeMessage = customMessage
    ? `<p>${escapeHtml(customMessage)}</p>`
    : '';
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:24px;color:#1f2937">
    <h2 style="margin:0 0 16px">You have been invited</h2>
    <p>An administrator has invited you to join. Click the link below to create your account:</p>
    ${safeMessage}
    <p style="margin:24px 0"><a href="${signUpUrl}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">Sign up</a></p>
    <p style="color:#6b7280;font-size:12px">If the button doesn't work, paste this link in your browser:<br/>${signUpUrl}</p>
  </body></html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
