import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActivityAction,
  IssueLinkType,
  IssueType,
  IssuePriority,
  Prisma,
  StatusCategory,
  WorkspaceRole,
} from '@prisma/client';
import {
  MSG,
  USER_SELECT_BASIC,
  USER_SELECT_FULL,
  BOARD_COLUMN_SELECT,
} from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import {
  csvEscape,
  generateShareToken,
  newMentions,
  sanitizeRichHtml,
} from '@/core/utils';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { ProjectsService } from '@/modules/projects/projects.service';
import { WebhooksService } from '@/modules/webhooks/webhooks.service';
import { WorkspacesService } from '@/modules/workspaces/workspaces.service';
import { CreateIssueDto, UpdateIssueDto, MoveIssueDto } from './dto';

const ACTIVITY_LIMIT = 20;

const ISSUE_INCLUDE = {
  reporter: USER_SELECT_BASIC,
  assignee: USER_SELECT_BASIC,
  boardColumn: BOARD_COLUMN_SELECT,
  sprint: { select: { id: true, name: true, status: true } },
  parent: { select: { id: true, key: true, summary: true } },
  epic: { select: { id: true, key: true, summary: true } },
  labels: { include: { label: true } },
  _count: { select: { children: true, comments: true, attachments: true } },
};

// Peer issue summary used inside link rows. Kept lean — link tables can
// fan out to dozens of issues per detail page, so we skip the relations.
const ISSUE_LINK_PEER_SELECT = {
  select: {
    id: true,
    key: true,
    summary: true,
    type: true,
    boardColumn: BOARD_COLUMN_SELECT,
  },
} as const;

// Adds a `stars` filtered to the current user so the UI can render the toggle
// state. Empty array → not starred; one row → starred. We keep the static
// ISSUE_INCLUDE for hot paths and merge the per-user clause when we have a
// userId in scope.
function withUserMeta<T extends Record<string, unknown>>(
  include: T,
  userId: string,
) {
  return {
    ...include,
    stars: { where: { userId }, select: { userId: true } },
    watchers: { where: { userId }, select: { userId: true } },
  };
}

type IssueWithUserMeta = {
  stars?: { userId: string }[];
  watchers?: { userId: string }[];
} & Record<string, unknown>;

function decorateUserMeta<T extends IssueWithUserMeta>(
  issue: T,
): Omit<T, 'stars' | 'watchers'> & {
  starredByMe: boolean;
  watchedByMe: boolean;
} {
  const { stars, watchers, ...rest } = issue;
  return {
    ...rest,
    starredByMe: (stars ?? []).length > 0,
    watchedByMe: (watchers ?? []).length > 0,
  };
}

@Injectable()
export class IssuesService {
  constructor(
    private prisma: PrismaService,
    private workspacesService: WorkspacesService,
    private projectsService: ProjectsService,
    private notifications: NotificationsService,
    private webhooks: WebhooksService,
  ) {}

  async create(userId: string, dto: CreateIssueDto) {
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
      include: {
        board: {
          include: { columns: { orderBy: { position: 'asc' }, take: 1 } },
        },
      },
    });
    if (!project) throw new NotFoundException(MSG.ERROR.PROJECT_NOT_FOUND);

    await this.projectsService.assertProjectAccess(
      project.id,
      userId,
      project.workspaceId,
    );

    // Default to first column (To Do)
    const firstColumnId = project.board?.columns[0]?.id;

    // Wrap in transaction: counter increment + issue create + activity log
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.project.update({
        where: { id: project.id },
        data: { issueCounter: { increment: 1 } },
      });
      const key = `${project.key}-${updated.issueCounter}`;

      const issue = await tx.issue.create({
        data: {
          key,
          projectId: project.id,
          summary: dto.summary,
          description: dto.description
            ? sanitizeRichHtml(dto.description)
            : dto.description,
          type: dto.type,
          priority: dto.priority,
          reporterId: userId,
          assigneeId: dto.assigneeId,
          parentId: dto.parentId,
          epicId: dto.epicId,
          sprintId: dto.sprintId,
          boardColumnId: firstColumnId,
          storyPoints: dto.storyPoints,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        },
        include: withUserMeta(ISSUE_INCLUDE, userId),
      });

      await tx.activity.create({
        data: {
          issueId: issue.id,
          userId,
          action: ActivityAction.CREATED,
        },
      });

      // Notify the assignee on creation, unless they're the one creating
      // (someone assigning themselves shouldn't trigger a self-notification).
      if (dto.assigneeId && dto.assigneeId !== userId) {
        this.notifications.create(dto.assigneeId, {
          type: 'ISSUE_ASSIGNED',
          title: `You were assigned to ${issue.key}`,
          body: issue.summary,
          link: `/issues/${issue.key}`,
        });
      }
      // Auto-subscribe assignee + reporter so they receive future activity
      // notifications without an explicit "Watch" click.
      if (dto.assigneeId) this.autoWatch(issue.id, dto.assigneeId);
      this.autoWatch(issue.id, userId);

      this.webhooks.dispatch(project.workspaceId, 'issue.created', {
        issue: {
          id: issue.id,
          key: issue.key,
          summary: issue.summary,
          type: issue.type,
        },
        actor: { id: userId },
        link: `/issues/${issue.key}`,
      });

      return decorateUserMeta(issue);
    });
  }

  async findAll(
    projectId: string,
    userId: string,
    filters?: {
      sprintId?: string;
      assigneeId?: string;
      type?: string;
      priority?: string;
      search?: string;
      cursor?: string;
      take?: number;
    },
  ) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException(MSG.ERROR.PROJECT_NOT_FOUND);

    await this.projectsService.assertProjectAccess(
      project.id,
      userId,
      project.workspaceId,
    );

    const where = {
      projectId,
      ...(filters?.sprintId &&
        filters.sprintId !== 'backlog' && { sprintId: filters.sprintId }),
      ...(filters?.sprintId === 'backlog' && { sprintId: null }),
      ...(filters?.assigneeId && { assigneeId: filters.assigneeId }),
      ...(filters?.type && { type: filters.type as IssueType }),
      ...(filters?.priority && { priority: filters.priority as IssuePriority }),
      ...(filters?.search && {
        OR: [
          {
            summary: {
              contains: filters.search,
              mode: Prisma.QueryMode.insensitive,
            },
          },
          {
            key: {
              contains: filters.search,
              mode: Prisma.QueryMode.insensitive,
            },
          },
        ],
      }),
    };

    const take = filters?.take ?? 0; // 0 = no limit (backward compatible)

    const include = withUserMeta(ISSUE_INCLUDE, userId);

    // No pagination — return all (for board view, backlog DnD, etc.)
    if (!take) {
      const rows = await this.prisma.issue.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
      });
      return rows.map(decorateUserMeta);
    }

    // Cursor-based pagination
    const items = await this.prisma.issue.findMany({
      where,
      include,
      orderBy: { createdAt: 'desc' },
      take: take + 1, // Fetch 1 extra to check if there are more
      ...(filters?.cursor && {
        cursor: { id: filters.cursor },
        skip: 1, // Skip the cursor item itself
      }),
    });

    const hasMore = items.length > take;
    const data = (hasMore ? items.slice(0, take) : items).map(decorateUserMeta);
    const nextCursor = hasMore ? data[data.length - 1].id : null;

    return { data, nextCursor, hasMore };
  }

  async findMyDashboard(userId: string) {
    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const recentActivityCutoff = new Date(
      now.getTime() - 7 * 24 * 60 * 60 * 1000,
    );

    // Parallelize the two findMany calls — they're independent, so running
    // them sequentially would add a full round-trip of latency for no reason.
    const [open, recent, starred] = await Promise.all([
      // All non-DONE issues assigned to me, across any workspace I'm in
      this.prisma.issue.findMany({
        where: {
          assigneeId: userId,
          boardColumn: { category: { not: StatusCategory.DONE } },
          project: {
            workspace: { members: { some: { userId } } },
          },
        },
        include: {
          ...withUserMeta(ISSUE_INCLUDE, userId),
          project: { select: { id: true, key: true, name: true } },
        },
        orderBy: [{ dueDate: 'asc' }, { updatedAt: 'desc' }],
      }),
      // Recently-touched issues across projects I can access. Workspace
      // OWNER/ADMIN see all projects; regular members see only projects they
      // are a member of.
      this.prisma.issue.findMany({
        where: {
          updatedAt: { gte: recentActivityCutoff },
          project: {
            OR: [
              { members: { some: { userId } } },
              {
                workspace: {
                  members: {
                    some: {
                      userId,
                      role: { in: [WorkspaceRole.OWNER, WorkspaceRole.ADMIN] },
                    },
                  },
                },
              },
            ],
          },
        },
        include: withUserMeta(ISSUE_INCLUDE, userId),
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
      // Issues this user has starred — small set, used by the dashboard
      // "Starred" widget.
      this.prisma.issue.findMany({
        where: { stars: { some: { userId } } },
        include: {
          ...withUserMeta(ISSUE_INCLUDE, userId),
          project: { select: { id: true, key: true, name: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      }),
    ]);

    const openDecorated = open.map(decorateUserMeta);
    const recentDecorated = recent.map(decorateUserMeta);
    const starredDecorated = starred.map(decorateUserMeta);

    const overdue = openDecorated.filter((i) => i.dueDate && i.dueDate < now);
    const dueSoon = openDecorated.filter(
      (i) => i.dueDate && i.dueDate >= now && i.dueDate <= in7Days,
    );

    return {
      assigned: openDecorated,
      overdue,
      dueSoon,
      recent: recentDecorated,
      starred: starredDecorated,
      stats: {
        total: openDecorated.length,
        overdue: overdue.length,
        dueSoon: dueSoon.length,
        starred: starredDecorated.length,
      },
    };
  }

  async findByKey(key: string, userId: string) {
    const issue = await this.prisma.issue.findUnique({
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
    if (!issue) throw new NotFoundException(MSG.ERROR.ISSUE_NOT_FOUND);

    await this.projectsService.assertProjectAccess(issue.projectId, userId);

    return decorateUserMeta(issue);
  }

  async findById(issueId: string, userId: string) {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      include: withUserMeta(ISSUE_INCLUDE, userId),
    });
    if (!issue) throw new NotFoundException(MSG.ERROR.ISSUE_NOT_FOUND);

    await this.projectsService.assertProjectAccess(issue.projectId, userId);

    return decorateUserMeta(issue);
  }

  async update(issueId: string, userId: string, dto: UpdateIssueDto) {
    const issue = await this.findById(issueId, userId);

    const data: Record<string, unknown> = {};
    const activities: {
      field: string;
      oldValue: string | null;
      newValue: string | null;
    }[] = [];

    const stringifyValue = (v: unknown): string | null => {
      if (v == null) return null;
      if (v instanceof Date) return v.toISOString();
      if (typeof v === 'string') return v;
      if (
        typeof v === 'number' ||
        typeof v === 'boolean' ||
        typeof v === 'bigint'
      ) {
        return v.toString();
      }
      return JSON.stringify(v);
    };

    for (const [field, value] of Object.entries(dto)) {
      if (value === undefined) continue;
      const oldVal = (issue as Record<string, unknown>)[field];
      if (field === 'dueDate' || field === 'startDate') {
        data[field] = value ? new Date(value as string) : null;
      } else if (field === 'description') {
        data[field] = value ? sanitizeRichHtml(value as string) : value;
      } else {
        data[field] = value;
      }
      activities.push({
        field,
        oldValue: stringifyValue(oldVal),
        newValue: stringifyValue(value),
      });
    }

    const updated = await this.prisma.issue.update({
      where: { id: issueId },
      data,
      include: withUserMeta(ISSUE_INCLUDE, userId),
    });

    // Log activities
    if (activities.length > 0) {
      await this.prisma.activity.createMany({
        data: activities.map((a) => ({
          issueId,
          userId,
          action:
            a.field === 'assigneeId'
              ? ActivityAction.ASSIGNED
              : ActivityAction.UPDATED,
          field: a.field,
          oldValue: a.oldValue,
          newValue: a.newValue,
        })),
      });
    }

    // Notify the new assignee when ownership changed (and they're not the
    // person doing the assigning). The unassigned → null case is silent.
    const oldAssignee = (issue as { assigneeId: string | null }).assigneeId;
    const newAssignee = dto.assigneeId;
    if (
      newAssignee !== undefined &&
      newAssignee !== oldAssignee &&
      newAssignee &&
      newAssignee !== userId
    ) {
      this.notifications.create(newAssignee, {
        type: 'ISSUE_ASSIGNED',
        title: `You were assigned to ${updated.key}`,
        body: updated.summary,
        link: `/issues/${updated.key}`,
      });
      this.autoWatch(issueId, newAssignee);
    }

    // Description edit: surface freshly-introduced @mentions only.
    // Re-saving without changing mentions stays silent.
    if (dto.description !== undefined) {
      const before = (issue as { description: string | null }).description;
      const fresh = newMentions(before, dto.description).filter(
        (id) => id !== userId,
      );
      this.notifications.createMany(fresh, {
        type: 'MENTION_ISSUE',
        title: `You were mentioned on ${updated.key}`,
        body: updated.summary,
        link: `/issues/${updated.key}`,
      });
    }

    void this.fireIssueWebhook('issue.updated', updated, userId);

    return decorateUserMeta(updated);
  }

  async move(issueId: string, userId: string, dto: MoveIssueDto) {
    const issue = await this.findById(issueId, userId);

    const column = await this.prisma.boardColumn.findUnique({
      where: { id: dto.columnId },
    });
    if (!column) throw new NotFoundException(MSG.ERROR.COLUMN_NOT_FOUND);

    const oldColumnId = issue.boardColumnId;

    const updated = await this.prisma.issue.update({
      where: { id: issueId },
      data: {
        boardColumnId: dto.columnId,
        position: dto.position ?? 0,
        completedAt:
          column.category === StatusCategory.DONE ? new Date() : null,
      },
      include: withUserMeta(ISSUE_INCLUDE, userId),
    });

    // Log transition
    if (oldColumnId !== dto.columnId) {
      const oldColumn = oldColumnId
        ? await this.prisma.boardColumn.findUnique({
            where: { id: oldColumnId },
          })
        : null;

      await this.prisma.activity.create({
        data: {
          issueId,
          userId,
          action: ActivityAction.TRANSITIONED,
          field: 'status',
          oldValue: oldColumn?.name ?? null,
          newValue: column.name,
        },
      });

      // Notify reporter + watchers on column change. Skip the mover.
      const watcherRows = await this.prisma.issueWatcher.findMany({
        where: { issueId },
        select: { userId: true },
      });
      const recipients = [
        issue.reporterId,
        ...watcherRows.map((w) => w.userId),
      ].filter((id): id is string => !!id && id !== userId);
      this.notifications.createMany(recipients, {
        type: 'ISSUE_TRANSITIONED',
        title: `${updated.key} moved to ${column.name}`,
        body: updated.summary,
        link: `/issues/${updated.key}`,
      });
    }

    void this.fireIssueWebhook('issue.moved', updated, userId);

    return decorateUserMeta(updated);
  }

  async delete(issueId: string, userId: string) {
    const issue = await this.findById(issueId, userId);
    const result = await this.prisma.issue.delete({ where: { id: issueId } });
    void this.fireIssueWebhook('issue.deleted', issue, userId);
    return result;
  }

  // Look up the workspaceId for the issue's project then forward to the
  // webhook dispatcher. Pulled out so issue.create/update/move/delete don't
  // each duplicate the lookup.
  private async fireIssueWebhook(
    event: string,
    issue: {
      id: string;
      key: string;
      summary: string;
      type: string;
      projectId: string;
    },
    actorId: string,
  ): Promise<void> {
    const project = await this.prisma.project
      .findUnique({
        where: { id: issue.projectId },
        select: { workspaceId: true },
      })
      .catch(() => null);
    if (!project) return;
    this.webhooks.dispatch(project.workspaceId, event, {
      issue: {
        id: issue.id,
        key: issue.key,
        summary: issue.summary,
        type: issue.type,
      },
      actor: { id: actorId },
      link: `/issues/${issue.key}`,
    });
  }

  // ─── Star / Favorite ──────────────────────────────────

  // Idempotent: starring an already-starred issue is a no-op (upsert pattern).
  async star(issueId: string, userId: string) {
    await this.findById(issueId, userId);
    await this.prisma.issueStar.upsert({
      where: { issueId_userId: { issueId, userId } },
      update: {},
      create: { issueId, userId },
    });
    return { starred: true };
  }

  async unstar(issueId: string, userId: string) {
    await this.findById(issueId, userId);
    await this.prisma.issueStar
      .delete({ where: { issueId_userId: { issueId, userId } } })
      .catch(() => null); // already unstarred → silent no-op
    return { starred: false };
  }

  // ─── Watch / Subscribe ───────────────────────────────

  async watch(issueId: string, userId: string) {
    await this.findById(issueId, userId);
    await this.prisma.issueWatcher.upsert({
      where: { issueId_userId: { issueId, userId } },
      update: {},
      create: { issueId, userId },
    });
    return { watching: true };
  }

  async unwatch(issueId: string, userId: string) {
    await this.findById(issueId, userId);
    await this.prisma.issueWatcher
      .delete({ where: { issueId_userId: { issueId, userId } } })
      .catch(() => null);
    return { watching: false };
  }

  async findWatchers(issueId: string, userId: string) {
    await this.findById(issueId, userId);
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

  // ─── Share Tokens (public read-only links) ───────────

  /**
   * Mint a fresh share token. Caller must be a project member — token grants
   * read-only access to anyone with the URL, so we gate creation, not reads.
   */
  async createShareToken(
    issueId: string,
    userId: string,
    opts?: { expiresInSec?: number },
  ) {
    await this.findById(issueId, userId);
    const token = generateShareToken();
    const expiresAt =
      opts?.expiresInSec && opts.expiresInSec > 0
        ? new Date(Date.now() + opts.expiresInSec * 1000)
        : null;
    return this.prisma.issueShareToken.create({
      data: { issueId, createdById: userId, token, expiresAt },
    });
  }

  async listShareTokens(issueId: string, userId: string) {
    await this.findById(issueId, userId);
    return this.prisma.issueShareToken.findMany({
      where: { issueId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeShareToken(issueId: string, tokenId: string, userId: string) {
    await this.findById(issueId, userId);
    const tok = await this.prisma.issueShareToken.findUnique({
      where: { id: tokenId },
    });
    if (!tok || tok.issueId !== issueId) {
      throw new NotFoundException(MSG.ERROR.SHARE_TOKEN_NOT_FOUND);
    }
    await this.prisma.issueShareToken.delete({ where: { id: tokenId } });
  }

  /**
   * Public — no auth. Returns a slimmed-down issue suitable for a read-only
   * page. Bumps viewCount fire-and-forget so it doesn't add latency to the
   * public read path.
   */
  async findByShareToken(token: string) {
    const tok = await this.prisma.issueShareToken.findUnique({
      where: { token },
    });
    if (!tok) throw new NotFoundException(MSG.ERROR.SHARE_TOKEN_NOT_FOUND);
    if (tok.expiresAt && tok.expiresAt < new Date()) {
      throw new NotFoundException(MSG.ERROR.SHARE_TOKEN_EXPIRED);
    }

    const issue = await this.prisma.issue.findUnique({
      where: { id: tok.issueId },
      // Keep author/assignee names but drop emails. Skip worklogs entirely
      // — those carry hours/cost data that shouldn't leak via a copy-pasted
      // link.
      include: {
        reporter: USER_SELECT_BASIC,
        assignee: USER_SELECT_BASIC,
        boardColumn: BOARD_COLUMN_SELECT,
        labels: { include: { label: true } },
        comments: {
          include: { author: USER_SELECT_BASIC },
          orderBy: { createdAt: 'asc' },
        },
        attachments: {
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            fileSize: true,
            createdAt: true,
          },
        },
      },
    });
    if (!issue) throw new NotFoundException(MSG.ERROR.ISSUE_NOT_FOUND);

    void this.prisma.issueShareToken
      .update({
        where: { id: tok.id },
        data: { viewCount: { increment: 1 } },
      })
      .catch(() => null);

    return issue;
  }

  // ─── Issue Links ─────────────────────────────────────

  async createLink(
    sourceIssueId: string,
    userId: string,
    dto: { targetIssueId: string; type: IssueLinkType },
  ) {
    if (sourceIssueId === dto.targetIssueId) {
      throw new BadRequestException(MSG.ERROR.ISSUE_LINK_SELF);
    }
    // Both ends must exist + caller must have access to BOTH (linking across
    // projects you can't see leaks issue keys/summaries).
    await this.findById(sourceIssueId, userId);
    await this.findById(dto.targetIssueId, userId);

    try {
      return await this.prisma.issueLink.create({
        data: {
          sourceIssueId,
          targetIssueId: dto.targetIssueId,
          type: dto.type,
        },
        include: { target: ISSUE_LINK_PEER_SELECT },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(MSG.ERROR.ISSUE_LINK_EXISTS);
      }
      throw err;
    }
  }

  async deleteLink(issueId: string, linkId: string, userId: string) {
    await this.findById(issueId, userId);
    const link = await this.prisma.issueLink.findUnique({
      where: { id: linkId },
    });
    if (!link) throw new NotFoundException(MSG.ERROR.ISSUE_LINK_NOT_FOUND);
    // Allow deletion from either end of the link — both sides see it.
    if (link.sourceIssueId !== issueId && link.targetIssueId !== issueId) {
      throw new NotFoundException(MSG.ERROR.ISSUE_LINK_NOT_FOUND);
    }
    await this.prisma.issueLink.delete({ where: { id: linkId } });
  }

  // ─── Export ───────────────────────────────────────────

  // Plain CSV. Headers chosen to match what users typically slice in Excel:
  // identifiers, type/status/priority, who's working on it, dates. Description
  // is intentionally omitted — it's HTML now and would explode row sizes.
  async exportCsv(projectId: string, userId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException(MSG.ERROR.PROJECT_NOT_FOUND);

    await this.projectsService.assertProjectAccess(
      project.id,
      userId,
      project.workspaceId,
    );

    const rows = await this.prisma.issue.findMany({
      where: { projectId },
      include: {
        // FULL select: CSV falls back to email when display name is missing.
        reporter: USER_SELECT_FULL,
        assignee: USER_SELECT_FULL,
        boardColumn: BOARD_COLUMN_SELECT,
        sprint: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const headers = [
      'Key',
      'Summary',
      'Type',
      'Priority',
      'Status',
      'Assignee',
      'Reporter',
      'Sprint',
      'StoryPoints',
      'DueDate',
      'CreatedAt',
    ];

    const lines = [
      headers.join(','),
      ...rows.map((r) =>
        [
          r.key,
          r.summary,
          r.type,
          r.priority,
          r.boardColumn?.name ?? '',
          r.assignee?.name ?? r.assignee?.email ?? '',
          r.reporter?.name ?? r.reporter?.email ?? '',
          r.sprint?.name ?? '',
          r.storyPoints ?? '',
          r.dueDate ? r.dueDate.toISOString() : '',
          r.createdAt.toISOString(),
        ]
          .map(csvEscape)
          .join(','),
      ),
    ];

    return lines.join('\n');
  }

  // Lightweight endpoint for FE board/list views: returns just the IDs the
  // current user has starred. FE merges client-side to avoid join cost on
  // every list query.
  async findStarredIds(userId: string, projectId?: string) {
    const rows = await this.prisma.issueStar.findMany({
      where: {
        userId,
        ...(projectId && { issue: { projectId } }),
      },
      select: { issueId: true },
    });
    return rows.map((r) => r.issueId);
  }

  // ─── Activity ─────────────────────────────────────────

  async findActivity(issueId: string, userId: string) {
    await this.findById(issueId, userId);

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

    const [users, sprints, issueRefs] = await Promise.all([
      userIds.size
        ? this.prisma.user.findMany({
            where: { id: { in: [...userIds] } },
            select: { id: true, name: true, email: true },
          })
        : Promise.resolve(
            [] as { id: string; name: string | null; email: string }[],
          ),
      sprintIds.size
        ? this.prisma.sprint.findMany({
            where: { id: { in: [...sprintIds] } },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as { id: string; name: string }[]),
      issueIds.size
        ? this.prisma.issue.findMany({
            where: { id: { in: [...issueIds] } },
            select: { id: true, key: true, summary: true },
          })
        : Promise.resolve([] as { id: string; key: string; summary: string }[]),
    ]);

    const userMap = new Map<string, string>(
      users.map((u) => [u.id, u.name ?? u.email] as const),
    );
    const sprintMap = new Map<string, string>(
      sprints.map((s) => [s.id, s.name] as const),
    );
    const issueMap = new Map<string, string>(
      issueRefs.map((i) => [i.id, `${i.key} ${i.summary}`] as const),
    );

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

  // ─── Bulk Operations ──────────────────────────────────

  async bulkUpdate(
    userId: string,
    dto: {
      issueIds: string[];
      sprintId?: string | null;
      assigneeId?: string | null;
      priority?: string;
    },
  ) {
    // Verify access for first issue (all should be in same project)
    await this.findById(dto.issueIds[0], userId);

    const data: Record<string, unknown> = {};
    if (dto.sprintId !== undefined) data.sprintId = dto.sprintId;
    if (dto.assigneeId !== undefined) data.assigneeId = dto.assigneeId;
    if (dto.priority !== undefined) data.priority = dto.priority;

    const result = await this.prisma.issue.updateMany({
      where: { id: { in: dto.issueIds } },
      data,
    });

    return { count: result.count };
  }

  async bulkDelete(userId: string, issueIds: string[]) {
    // Verify access
    await this.findById(issueIds[0], userId);

    const result = await this.prisma.issue.deleteMany({
      where: { id: { in: issueIds } },
    });

    return { count: result.count };
  }

  // ─── Labels ───────────────────────────────────────────

  async addLabel(issueId: string, labelId: string, userId: string) {
    await this.findById(issueId, userId);

    return this.prisma.issueLabel.create({
      data: { issueId, labelId },
      include: { label: true },
    });
  }

  async removeLabel(issueId: string, labelId: string, userId: string) {
    await this.findById(issueId, userId);

    return this.prisma.issueLabel.delete({
      where: { issueId_labelId: { issueId, labelId } },
    });
  }
}
