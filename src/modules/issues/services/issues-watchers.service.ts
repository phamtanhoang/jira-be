import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { CacheTagsService } from '@/core/cache/cache-tags.service';
import { USER_SELECT_BASIC } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { IssuesService } from '../issues.service';

@Injectable()
export class IssuesWatchersService {
  constructor(
    private prisma: PrismaService,
    private cacheTags: CacheTagsService,
    @Inject(forwardRef(() => IssuesService))
    private issuesService: IssuesService,
  ) {}

  /**
   * Bust the per-issue cache (both id and key variants) after any
   * star/watch mutation. `findByKey` / `findById` wrap their results
   * with `cacheTags.wrap(..., ['issue:key:X' | 'issue:id:Y'], ttl=300s)`
   * — without invalidation the FE's re-fetch after a mutation gets the
   * stale row with the old `starredByMe` / `watchedByMe`, which is the
   * "I click star but UI flips back to grey" bug the FE was reporting.
   */
  private bustIssueCache(issueId: string, issueKey: string) {
    void this.cacheTags.invalidateTags([
      `issue:id:${issueId}`,
      `issue:key:${issueKey}`,
    ]);
  }

  // Idempotent: starring an already-starred issue is a no-op (upsert pattern).
  async star(issueId: string, userId: string) {
    const issue = await this.issuesService.findById(issueId, userId);
    await this.prisma.issueStar.upsert({
      where: { issueId_userId: { issueId, userId } },
      update: {},
      create: { issueId, userId },
    });
    this.bustIssueCache(issueId, issue.key);
    return { starred: true };
  }

  async unstar(issueId: string, userId: string) {
    const issue = await this.issuesService.findById(issueId, userId);
    await this.prisma.issueStar
      .delete({ where: { issueId_userId: { issueId, userId } } })
      .catch(() => null); // already unstarred → silent no-op
    this.bustIssueCache(issueId, issue.key);
    return { starred: false };
  }

  async watch(issueId: string, userId: string) {
    const issue = await this.issuesService.findById(issueId, userId);
    await this.prisma.issueWatcher.upsert({
      where: { issueId_userId: { issueId, userId } },
      update: {},
      create: { issueId, userId },
    });
    this.bustIssueCache(issueId, issue.key);
    return { watching: true };
  }

  async unwatch(issueId: string, userId: string) {
    const issue = await this.issuesService.findById(issueId, userId);
    await this.prisma.issueWatcher
      .delete({ where: { issueId_userId: { issueId, userId } } })
      .catch(() => null);
    this.bustIssueCache(issueId, issue.key);
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
