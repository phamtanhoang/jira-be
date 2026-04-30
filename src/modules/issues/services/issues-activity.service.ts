import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { CacheTagsService } from '@/core/cache/cache-tags.service';
import { USER_SELECT_BASIC } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { IssuesRepository } from '../issues.repository';
import { IssuesService } from '../issues.service';

@Injectable()
export class IssuesActivityService {
  constructor(
    private prisma: PrismaService,
    private issuesRepository: IssuesRepository,
    private cacheTags: CacheTagsService,
    @Inject(forwardRef(() => IssuesService))
    private issuesService: IssuesService,
  ) {}

  async findActivity(issueId: string, userId: string) {
    // Activity feed is read every modal open. Access check must run on every
    // call (workspace/project membership) — wrap only the heavy data load.
    await this.issuesService.findById(issueId, userId);

    return this.cacheTags.wrap(
      `issue:activity:${issueId}`,
      [`issue:id:${issueId}`],
      () => this.loadActivity(issueId),
    );
  }

  private async loadActivity(issueId: string) {
    const rows = await this.prisma.activity.findMany({
      where: { issueId },
      include: { user: USER_SELECT_BASIC },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // Field → kind of entity referenced by oldValue/newValue. We resolve these
    // lazily so the activity feed can show "Alice" instead of a raw UUID even
    // when the user was later renamed.
    const USER_FIELDS = new Set(['assigneeId', 'reporterId']);
    const SPRINT_FIELDS = new Set(['sprintId']);
    const ISSUE_FIELDS = new Set(['parentId', 'epicId']);

    const userIds = new Set<string>();
    const sprintIds = new Set<string>();
    const issueIds = new Set<string>();

    for (const r of rows) {
      const field = r.field ?? '';
      for (const v of [r.oldValue, r.newValue]) {
        if (!v) continue;
        if (USER_FIELDS.has(field)) userIds.add(v);
        else if (SPRINT_FIELDS.has(field)) sprintIds.add(v);
        else if (ISSUE_FIELDS.has(field)) issueIds.add(v);
      }
    }

    const {
      users: userMap,
      sprints: sprintMap,
      issues: issueMap,
    } = await this.issuesRepository.resolveActivityRefs({
      userIds,
      sprintIds,
      issueIds,
    });

    function resolve(field: string | null, value: string | null) {
      if (!value) return value;
      if (field && USER_FIELDS.has(field)) return userMap.get(value) ?? null;
      if (field && SPRINT_FIELDS.has(field))
        return sprintMap.get(value) ?? null;
      if (field && ISSUE_FIELDS.has(field)) return issueMap.get(value) ?? null;
      return value;
    }

    return rows.map((r) => ({
      ...r,
      oldValueDisplay: resolve(r.field, r.oldValue),
      newValueDisplay: resolve(r.field, r.newValue),
    }));
  }
}
