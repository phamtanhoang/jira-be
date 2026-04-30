import {
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
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
import { MSG } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { IssueNotFoundException } from '@/core/exceptions';
import { newMentions, sanitizeRichHtml } from '@/core/utils';
import { CustomFieldsService } from '@/modules/custom-fields/custom-fields.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { ProjectsService } from '@/modules/projects/projects.service';
import { WebhooksService } from '@/modules/webhooks/webhooks.service';
import { WorkspacesService } from '@/modules/workspaces/workspaces.service';
import { CreateIssueDto, UpdateIssueDto, MoveIssueDto } from './dto';
import { IssuesRepository } from './issues.repository';
import {
  ISSUE_INCLUDE,
  customFieldValueMatch,
  decorateUserMeta,
  withUserMeta,
} from './issues.shared';
import { IssuesActivityService } from './services/issues-activity.service';
import { IssuesBulkService } from './services/issues-bulk.service';
import { IssuesExportService } from './services/issues-export.service';
import { IssuesLabelsService } from './services/issues-labels.service';
import { IssuesLinksService } from './services/issues-links.service';
import { IssuesShareService } from './services/issues-share.service';
import { IssuesWatchersService } from './services/issues-watchers.service';

/**
 * Façade for the issue domain. Public API matches the pre-split version
 * one-for-one — controllers and other modules continue to inject
 * `IssuesService` and call the same methods. Behaviour-specific work has
 * been moved into focused sub-services (Labels, Links, Share, Watchers,
 * Bulk, Export, Activity) under `./services/`. Core CRUD (create, find*,
 * update, move, delete, dashboard, search, custom-field clauses, webhook
 * fan-out) stays here because it is tightly coupled.
 */
@Injectable()
export class IssuesService {
  constructor(
    private prisma: PrismaService,
    private workspacesService: WorkspacesService,
    private projectsService: ProjectsService,
    private notifications: NotificationsService,
    private webhooks: WebhooksService,
    private customFields: CustomFieldsService,
    private issuesRepository: IssuesRepository,
    @Inject(forwardRef(() => IssuesActivityService))
    private activityService: IssuesActivityService,
    @Inject(forwardRef(() => IssuesBulkService))
    private bulkService: IssuesBulkService,
    private exportService: IssuesExportService,
    @Inject(forwardRef(() => IssuesLabelsService))
    private labelsService: IssuesLabelsService,
    @Inject(forwardRef(() => IssuesLinksService))
    private linksService: IssuesLinksService,
    @Inject(forwardRef(() => IssuesShareService))
    private shareService: IssuesShareService,
    @Inject(forwardRef(() => IssuesWatchersService))
    private watchersService: IssuesWatchersService,
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
      if (dto.assigneeId)
        this.watchersService.autoWatch(issue.id, dto.assigneeId);
      this.watchersService.autoWatch(issue.id, userId);

      // Apply custom field values if the payload includes them. Best-effort:
      // a bad fieldId or wrong-type value is silently dropped rather than
      // failing the whole issue create.
      if (dto.customFields) {
        await this.customFields
          .applyCustomFieldValues(issue.id, project.id, dto.customFields)
          .catch(() => null);
      }

      void this.fireIssueWebhook('issue.created', issue, userId);

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
      // Map of customFieldId → value to filter by. Accepted shapes:
      //   TEXT      → string (case-insensitive contains)
      //   NUMBER    → string parsed as Number (exact match)
      //   DATE      → ISO date string (exact day match)
      //   SELECT    → string (must appear in `valueSelect`)
      //   MULTI_SELECT → string OR string[] (any of the values must match)
      // Unknown fieldIds are silently ignored.
      customFields?: Record<string, string | string[]>;
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

    const customFieldClauses = await this.buildCustomFieldClauses(
      projectId,
      filters?.customFields,
    );

    const where: Prisma.IssueWhereInput = {
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
      ...(customFieldClauses.length > 0 && { AND: customFieldClauses }),
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
    const issue = await this.issuesRepository.findByKeyWithRelations(
      key,
      userId,
    );
    if (!issue) throw new IssueNotFoundException();

    await this.projectsService.assertProjectAccess(issue.projectId, userId);

    return decorateUserMeta(issue);
  }

  async findById(issueId: string, userId: string) {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      include: withUserMeta(ISSUE_INCLUDE, userId),
    });
    if (!issue) throw new IssueNotFoundException();

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
      // customFields is handled out-of-band after the issue update.
      if (field === 'customFields') continue;
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
      this.watchersService.autoWatch(issueId, newAssignee);
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

    if (dto.customFields) {
      await this.customFields
        .applyCustomFieldValues(issueId, issue.projectId, dto.customFields)
        .catch(() => null);
    }

    void this.fireIssueWebhook('issue.updated', updated, userId);

    return decorateUserMeta(updated);
  }

  async move(issueId: string, userId: string, dto: MoveIssueDto) {
    const issue = await this.findById(issueId, userId);
    const oldColumnId = issue.boardColumnId;
    const isTransition = oldColumnId !== dto.columnId;

    // Read both columns in one round-trip — they're independent lookups.
    const [newColumn, oldColumn] = await Promise.all([
      this.prisma.boardColumn.findUnique({ where: { id: dto.columnId } }),
      oldColumnId && isTransition
        ? this.prisma.boardColumn.findUnique({ where: { id: oldColumnId } })
        : Promise.resolve(null),
    ]);
    if (!newColumn) throw new NotFoundException(MSG.ERROR.COLUMN_NOT_FOUND);

    // Atomic: issue.update + activity.create commit together so a column
    // move never leaves an orphan activity row (or vice versa).
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.issue.update({
        where: { id: issueId },
        data: {
          boardColumnId: dto.columnId,
          position: dto.position ?? 0,
          completedAt:
            newColumn.category === StatusCategory.DONE ? new Date() : null,
        },
        include: withUserMeta(ISSUE_INCLUDE, userId),
      });
      if (isTransition) {
        await tx.activity.create({
          data: {
            issueId,
            userId,
            action: ActivityAction.TRANSITIONED,
            field: 'status',
            oldValue: oldColumn?.name ?? null,
            newValue: newColumn.name,
          },
        });
      }
      return result;
    });

    // Notification fanout runs after the atomic write so a notification
    // failure can't roll back the move.
    if (isTransition) {
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
        title: `${updated.key} moved to ${newColumn.name}`,
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

  /**
   * Translate the FE's `customFields` filter map into Prisma `where` clauses.
   * Each entry becomes a `customFieldValues: { some: { fieldId, ...match } }`
   * combined under AND so filters compose. Definitions are loaded once to
   * coerce raw input strings into the right column (text/number/date/select).
   */
  private async buildCustomFieldClauses(
    projectId: string,
    raw: Record<string, string | string[]> | undefined,
  ): Promise<Prisma.IssueWhereInput[]> {
    if (!raw) return [];
    const fieldIds = Object.keys(raw).filter((id) => {
      const v = raw[id];
      if (Array.isArray(v)) return v.length > 0;
      return typeof v === 'string' && v.length > 0;
    });
    if (fieldIds.length === 0) return [];

    const defs = await this.prisma.customFieldDef.findMany({
      where: { projectId, id: { in: fieldIds } },
      select: { id: true, type: true },
    });
    const defById = new Map(defs.map((d) => [d.id, d.type]));

    const clauses: Prisma.IssueWhereInput[] = [];
    for (const fieldId of fieldIds) {
      const type = defById.get(fieldId);
      if (!type) continue;
      const value = raw[fieldId];
      const match = customFieldValueMatch(type, value);
      if (!match) continue;
      clauses.push({
        customFieldValues: { some: { fieldId, ...match } },
      });
    }
    return clauses;
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

  // ─── Façade: delegate to sub-services ─────────────────
  // Public API stays byte-identical so controllers and external callers
  // (public.controller, comments.service) need no changes.

  star(issueId: string, userId: string) {
    return this.watchersService.star(issueId, userId);
  }

  unstar(issueId: string, userId: string) {
    return this.watchersService.unstar(issueId, userId);
  }

  watch(issueId: string, userId: string) {
    return this.watchersService.watch(issueId, userId);
  }

  unwatch(issueId: string, userId: string) {
    return this.watchersService.unwatch(issueId, userId);
  }

  findWatchers(issueId: string, userId: string) {
    return this.watchersService.findWatchers(issueId, userId);
  }

  autoWatch(issueId: string, userId: string): void {
    this.watchersService.autoWatch(issueId, userId);
  }

  addLabel(issueId: string, labelId: string, userId: string) {
    return this.labelsService.addLabel(issueId, labelId, userId);
  }

  removeLabel(issueId: string, labelId: string, userId: string) {
    return this.labelsService.removeLabel(issueId, labelId, userId);
  }

  createLink(
    sourceIssueId: string,
    userId: string,
    dto: { targetIssueId: string; type: IssueLinkType },
  ) {
    return this.linksService.createLink(sourceIssueId, userId, dto);
  }

  deleteLink(issueId: string, linkId: string, userId: string) {
    return this.linksService.deleteLink(issueId, linkId, userId);
  }

  createShareToken(
    issueId: string,
    userId: string,
    opts?: { expiresInSec?: number },
  ) {
    return this.shareService.createShareToken(issueId, userId, opts);
  }

  listShareTokens(issueId: string, userId: string) {
    return this.shareService.listShareTokens(issueId, userId);
  }

  revokeShareToken(issueId: string, tokenId: string, userId: string) {
    return this.shareService.revokeShareToken(issueId, tokenId, userId);
  }

  findByShareToken(token: string) {
    return this.shareService.findByShareToken(token);
  }

  bulkUpdate(
    userId: string,
    dto: {
      issueIds: string[];
      sprintId?: string | null;
      assigneeId?: string | null;
      priority?: string;
    },
  ) {
    return this.bulkService.bulkUpdate(userId, dto);
  }

  bulkDelete(userId: string, issueIds: string[]) {
    return this.bulkService.bulkDelete(userId, issueIds);
  }

  exportCsv(projectId: string, userId: string) {
    return this.exportService.exportCsv(projectId, userId);
  }

  findActivity(issueId: string, userId: string) {
    return this.activityService.findActivity(issueId, userId);
  }
}
