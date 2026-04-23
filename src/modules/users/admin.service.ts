import { Injectable } from '@nestjs/common';
import { LogLevel } from '@prisma/client';
import { PrismaService } from '@/core/database/prisma.service';

type LogLevelCounts = Record<LogLevel, number>;

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
}
