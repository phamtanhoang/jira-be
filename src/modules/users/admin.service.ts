import { Injectable, NotFoundException } from '@nestjs/common';
import { LogLevel, Prisma } from '@prisma/client';
import { MSG, USER_SELECT_BASIC } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
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

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

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
    ]);

    const logs: LogLevelCounts = { INFO: 0, WARN: 0, ERROR: 0 };
    for (const row of logsGrouped) {
      const count = row._count as { level?: number } | undefined;
      logs[row.level] = count?.level ?? 0;
    }

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

    const [signupsRaw, issuesRaw, workspacesRaw, logsRaw] = await Promise.all([
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
      requestsByLevel: logBuckets(),
    };
  }

  /**
   * Performance hotspots for the past N hours: top-10 routes by request
   * count with p50/p95/p99 latency + error count, plus method/status
   * distributions.
   */
  async getMetrics(sinceHours = 24) {
    const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);

    const [topRoutesRaw, methodsRaw, statusesRaw] = await Promise.all([
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
        LIMIT 10
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

  async deleteWorkspace(id: string) {
    const exists = await this.prisma.workspace.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException(MSG.ERROR.WORKSPACE_NOT_FOUND);
    await this.prisma.workspace.delete({ where: { id } });
    return { message: MSG.SUCCESS.WORKSPACE_DELETED };
  }
}
