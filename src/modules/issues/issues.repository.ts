import { Injectable } from '@nestjs/common';
import { BOARD_COLUMN_SELECT, USER_SELECT_BASIC } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import {
  ACTIVITY_LIMIT,
  ISSUE_INCLUDE,
  ISSUE_LINK_PEER_SELECT,
  withUserMeta,
} from './issues.shared';

/**
 * Pure data-access layer for the issue domain. Keep this file query-focused:
 *
 * - Returns Prisma rows or `null`. Throws no HTTP exceptions — that is the
 *   service's job.
 * - Knows nothing about permissions. Workspace / project access checks live
 *   in the service layer.
 * - Inline simple `findUnique` / `count` calls in the service is fine; this
 *   class houses the queries that build dynamic `where` clauses, fan out to
 *   3+ tables, or are reused across services.
 */
@Injectable()
export class IssuesRepository {
  constructor(private prisma: PrismaService) {}

  /**
   * Pull the issue detail used by `findByKey`. Wide include — children,
   * comments, recent activity, both directions of linked issues. Heavy for
   * a list endpoint, OK for a single-issue page.
   */
  findByKeyWithRelations(key: string, userId: string) {
    return this.prisma.issue.findUnique({
      where: { key },
      include: {
        ...withUserMeta(ISSUE_INCLUDE, userId),
        children: {
          include: {
            assignee: USER_SELECT_BASIC,
            boardColumn: BOARD_COLUMN_SELECT,
          },
          orderBy: { createdAt: 'asc' },
        },
        comments: {
          include: { author: USER_SELECT_BASIC },
          orderBy: { createdAt: 'asc' },
        },
        activities: {
          include: { user: USER_SELECT_BASIC },
          orderBy: { createdAt: 'desc' },
          take: ACTIVITY_LIMIT,
        },
        outboundLinks: {
          include: { target: ISSUE_LINK_PEER_SELECT },
          orderBy: { createdAt: 'asc' },
        },
        inboundLinks: {
          include: { source: ISSUE_LINK_PEER_SELECT },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  /**
   * Batch-resolve UUIDs that show up in activity rows back to display names
   * (current — not the value at log-time, so renames flow through). Called
   * after the activity rows are loaded and the caller has scanned them for
   * referenced IDs.
   *
   * Returns three Maps: id → display string. Missing IDs are simply absent.
   */
  async resolveActivityRefs(args: {
    userIds: Set<string>;
    sprintIds: Set<string>;
    issueIds: Set<string>;
  }): Promise<{
    users: Map<string, string>;
    sprints: Map<string, string>;
    issues: Map<string, string>;
  }> {
    const [users, sprints, issueRefs] = await Promise.all([
      args.userIds.size
        ? this.prisma.user.findMany({
            where: { id: { in: [...args.userIds] } },
            select: { id: true, name: true, email: true },
          })
        : Promise.resolve(
            [] as { id: string; name: string | null; email: string }[],
          ),
      args.sprintIds.size
        ? this.prisma.sprint.findMany({
            where: { id: { in: [...args.sprintIds] } },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as { id: string; name: string }[]),
      args.issueIds.size
        ? this.prisma.issue.findMany({
            where: { id: { in: [...args.issueIds] } },
            select: { id: true, key: true, summary: true },
          })
        : Promise.resolve([] as { id: string; key: string; summary: string }[]),
    ]);

    return {
      users: new Map(users.map((u) => [u.id, u.name ?? u.email] as const)),
      sprints: new Map(sprints.map((s) => [s.id, s.name] as const)),
      issues: new Map(
        issueRefs.map((i) => [i.id, `${i.key} ${i.summary}`] as const),
      ),
    };
  }
}
