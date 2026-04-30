import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { USER_SELECT_BASIC } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { IssuesService } from '../issues.service';

@Injectable()
export class IssuesWatchersService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => IssuesService))
    private issuesService: IssuesService,
  ) {}

  // Idempotent: starring an already-starred issue is a no-op (upsert pattern).
  async star(issueId: string, userId: string) {
    await this.issuesService.findById(issueId, userId);
    await this.prisma.issueStar.upsert({
      where: { issueId_userId: { issueId, userId } },
      update: {},
      create: { issueId, userId },
    });
    return { starred: true };
  }

  async unstar(issueId: string, userId: string) {
    await this.issuesService.findById(issueId, userId);
    await this.prisma.issueStar
      .delete({ where: { issueId_userId: { issueId, userId } } })
      .catch(() => null); // already unstarred → silent no-op
    return { starred: false };
  }

  async watch(issueId: string, userId: string) {
    await this.issuesService.findById(issueId, userId);
    await this.prisma.issueWatcher.upsert({
      where: { issueId_userId: { issueId, userId } },
      update: {},
      create: { issueId, userId },
    });
    return { watching: true };
  }

  async unwatch(issueId: string, userId: string) {
    await this.issuesService.findById(issueId, userId);
    await this.prisma.issueWatcher
      .delete({ where: { issueId_userId: { issueId, userId } } })
      .catch(() => null);
    return { watching: false };
  }

  async findWatchers(issueId: string, userId: string) {
    await this.issuesService.findById(issueId, userId);
    const rows = await this.prisma.issueWatcher.findMany({
      where: { issueId },
      include: { user: USER_SELECT_BASIC },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => r.user);
  }

  // Internal-only, fire-and-forget. Called by issue.create/update (assignee)
  // and comments.create (commenter) to keep watchers populated without
  // surfacing a UI choice. Idempotent.
  autoWatch(issueId: string, userId: string): void {
    if (!issueId || !userId) return;
    void this.prisma.issueWatcher
      .upsert({
        where: { issueId_userId: { issueId, userId } },
        update: {},
        create: { issueId, userId },
      })
      .catch(() => null);
  }
}
