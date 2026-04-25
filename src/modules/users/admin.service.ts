import { Injectable, NotFoundException } from '@nestjs/common';
import { LogLevel, Prisma } from '@prisma/client';
import { MSG, USER_SELECT_BASIC } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
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

    return { data: rows, nextCursor, hasMore };
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
}
