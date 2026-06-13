import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
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
import { CacheTagsService } from '@/core/cache/cache-tags.service';
import { MSG } from '@/core/constants';
import { WEEK_MS } from '@/core/constants/time.constant';
import { PrismaService } from '@/core/database/prisma.service';
import {
  ColumnNotFoundException,
  IssueNotFoundException,
  ProjectNotFoundException,
} from '@/core/exceptions';
import { newMentions, sanitizeRichHtml } from '@/core/utils';
import { CustomFieldsService } from '@/modules/custom-fields/custom-fields.service';
import { RealtimeEventsService } from '@/modules/events/events.service';
import { REALTIME_EVENTS } from '@/modules/events/events.types';
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
  private readonly logger = new Logger(IssuesService.name);

  constructor(
    private prisma: PrismaService,
    private workspacesService: WorkspacesService,
    private projectsService: ProjectsService,
    private notifications: NotificationsService,
    private webhooks: WebhooksService,
    private customFields: CustomFieldsService,
    private cacheTags: CacheTagsService,
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
    private realtime: RealtimeEventsService,
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
    if (!project) throw new ProjectNotFoundException();

    await this.projectsService.assertProjectAccess(
      project.id,
      userId,
      project.workspaceId,
    );

    // Cross-entity scope checks. Without these, a caller can pass an
    // `epicId` / `parentId` from another project, or a `sprintId` from a
    // different board — Prisma accepts the foreign key (the rows exist),
    // leaving silently-corrupt cross-project references.
    await this.assertIssueFkScope(dto, project.id);

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
      // failing the whole issue create. Log so admins can spot regressions.
      if (dto.customFields) {
        await this.customFields
          .applyCustomFieldValues(issue.id, project.id, dto.customFields)
          .catch((err) =>
            this.logger.warn(
              `applyCustomFieldValues (create issue=${issue.id}) failed: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
      }

      void this.fireIssueWebhook('issue.created', issue, userId);

      // Realtime — every open board/backlog viewer refreshes their
      // issues list. Per-issue channel is meaningless here (no one is
      // viewing an issue that just got created).
      this.realtime.emit({
        type: REALTIME_EVENTS.ISSUE_CREATED,
        actorId: userId,
        projectId: project.id,
        issueId: issue.id,
        issueKey: issue.key,
      });

      return decorateUserMeta(issue);
    });
  }

  async findAll(
    projectId: string | undefined,
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
      // Match issues having ANY of these label IDs (OR semantics). Empty
      // array is treated as "no filter" — same as undefined.
      labelIds?: string[];
    },
  ) {
    // Global Cmd-K search omits projectId. Without this branch the
    // service hits `findUnique({where:{id: undefined}})` which throws
    // PrismaClientValidationError → 500. When projectId is missing,
    // restrict to projects the user can see and require a search term
    // (no point listing every accessible issue with no filter).
    let projectScope: Prisma.IssueWhereInput;
    if (!projectId) {
      if (!filters?.search || filters.search.trim().length < 2) {
        return [];
      }
      projectScope = {
        project: {
          workspace: { members: { some: { userId } } },
        },
      };
    } else {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
      });
      if (!project) throw new ProjectNotFoundException();

      await this.projectsService.assertProjectAccess(
        project.id,
        userId,
        project.workspaceId,
      );
      projectScope = { projectId };
    }

    const customFieldClauses = await this.buildCustomFieldClauses(
      projectId,
      filters?.customFields,
    );

    const where: Prisma.IssueWhereInput = {
      ...projectScope,
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
      ...(filters?.labelIds &&
        filters.labelIds.length > 0 && {
          labels: { some: { labelId: { in: filters.labelIds } } },
        }),
      ...(customFieldClauses.length > 0 && { AND: customFieldClauses }),
    };

    // `take = 0` historically meant "no limit" for the board / backlog
    // view. We still honour that, but clamp the "no limit" path to a
    // hard ceiling so a runaway caller can't load 100k issues into memory.
    const ALL_ISSUES_HARD_CAP = 1000;
    const take = filters?.take ?? 0;

    const include = withUserMeta(ISSUE_INCLUDE, userId);

    if (!take) {
      const rows = await this.prisma.issue.findMany({
        where,
        include,
        orderBy: { createdAt: 'desc' },
        take: ALL_ISSUES_HARD_CAP,
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
    const in7Days = new Date(now.getTime() + WEEK_MS);
    const recentActivityCutoff = new Date(now.getTime() - WEEK_MS);

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
    // Per-user cache key — `withUserMeta` bakes `stars`/`watchers` filtered by
    // userId into the result. Tagged by issue id (resolved after fetch) so
    // mutations on the issue invalidate every per-user variant.
    const cacheKey = `issue:key:${key}:user:${userId}`;
    return this.cacheTags.wrap(
      cacheKey,
      [`issue:key:${key}`],
      async () => {
        const issue = await this.issuesRepository.findByKeyWithRelations(
          key,
          userId,
        );
        if (!issue) throw new IssueNotFoundException();

        await this.projectsService.assertProjectAccess(issue.projectId, userId);

        return decorateUserMeta(issue);
      },
      /* ttlSec */ 300,
    );
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

    // Reassigning epic/sprint must stay inside the issue's project.
    // Otherwise a malicious caller could re-parent an issue under another
    // workspace's epic. (UpdateIssueDto does not expose `parentId` — that's
    // create-only, so the parent of an existing subtask is immutable.)
    if (dto.epicId !== undefined || dto.sprintId !== undefined) {
      await this.assertIssueFkScope(
        {
          epicId: dto.epicId ?? undefined,
          sprintId: dto.sprintId ?? undefined,
        },
        issue.projectId,
      );
    }

    // Changing the reporter is reserved for LEAD/ADMIN — mirrors the
    // FE gate so a hand-crafted PATCH can't bypass it. The new reporter
    // must also be a member of the project.
    if (dto.reporterId !== undefined && dto.reporterId !== issue.reporterId) {
      const actor = await this.prisma.projectMember.findFirst({
        where: { projectId: issue.projectId, userId },
        select: { role: true },
      });
      if (!actor || (actor.role !== 'LEAD' && actor.role !== 'ADMIN')) {
        throw new ForbiddenException(
          'Only project leads or admins can change the reporter',
        );
      }
      const newReporterMembership = await this.prisma.projectMember.count({
        where: { projectId: issue.projectId, userId: dto.reporterId },
      });
      if (newReporterMembership === 0) {
        throw new BadRequestException(
          'New reporter must be a member of this project',
        );
      }
    }

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
        // Empty string from the UI ("clear the date") needs to become
        // null, NOT `new Date('')` which silently stores Invalid Date and
        // crashes downstream serializers. A non-empty string that isn't a
        // real date is also rejected.
        if (value === null || value === '') {
          data[field] = null;
        } else {
          const parsed = new Date(value as string);
          if (Number.isNaN(parsed.getTime())) {
            throw new BadRequestException(`${field} must be a valid ISO date`);
          }
          data[field] = parsed;
        }
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

    // Atomic: issue update + activity log commit together. Without the
    // transaction a crash between the two would leave the issue mutated
    // but the audit trail empty — same invariant the move() method below
    // already enforces.
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.issue.update({
        where: { id: issueId },
        data,
        include: withUserMeta(ISSUE_INCLUDE, userId),
      });
      if (activities.length > 0) {
        await tx.activity.createMany({
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
      return next;
    });

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
        .catch((err) =>
          this.logger.warn(
            `applyCustomFieldValues (update issue=${issueId}) failed: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
    }

    void this.fireIssueWebhook('issue.updated', updated, userId);
    void this.cacheTags.invalidateTags([
      `issue:id:${issueId}`,
      `issue:key:${updated.key}`,
    ]);

    // Realtime — push to every open tab viewing this issue / project so
    // they invalidate their React Query cache without polling.
    this.realtime.emit({
      type: REALTIME_EVENTS.ISSUE_UPDATED,
      actorId: userId,
      projectId: issue.projectId,
      issueId,
      issueKey: updated.key,
    });

    return decorateUserMeta(updated);
  }

  async move(issueId: string, userId: string, dto: MoveIssueDto) {
    const issue = await this.findById(issueId, userId);
    const oldColumnId = issue.boardColumnId;
    const isTransition = oldColumnId !== dto.columnId;

    // Read both columns in one round-trip — they're independent lookups.
    // Include `board.projectId` on the destination column so we can verify
    // it belongs to the SAME board as the issue — otherwise the move
    // silently re-parents the issue under another project's board.
    const [newColumn, oldColumn] = await Promise.all([
      this.prisma.boardColumn.findUnique({
        where: { id: dto.columnId },
        include: { board: { select: { projectId: true } } },
      }),
      oldColumnId && isTransition
        ? this.prisma.boardColumn.findUnique({ where: { id: oldColumnId } })
        : Promise.resolve(null),
    ]);
    if (!newColumn) throw new ColumnNotFoundException();
    if (newColumn.board.projectId !== issue.projectId) {
      throw new BadRequestException(MSG.ERROR.COLUMN_NOT_IN_BOARD);
    }

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
    void this.cacheTags.invalidateTags([
      `issue:id:${issueId}`,
      `issue:key:${updated.key}`,
    ]);

    // Realtime — drag-drop moves are the highest-value cross-user
    // collaboration signal; every board viewer should see the card
    // shift columns within a second.
    this.realtime.emit({
      type: REALTIME_EVENTS.ISSUE_MOVED,
      actorId: userId,
      projectId: issue.projectId,
      issueId,
      issueKey: updated.key,
    });

    return decorateUserMeta(updated);
  }

  async delete(issueId: string, userId: string) {
    const issue = await this.findById(issueId, userId);
    const result = await this.prisma.issue.delete({ where: { id: issueId } });
    void this.fireIssueWebhook('issue.deleted', issue, userId);
    void this.cacheTags.invalidateTags([
      `issue:id:${issueId}`,
      `issue:key:${issue.key}`,
    ]);

    this.realtime.emit({
      type: REALTIME_EVENTS.ISSUE_DELETED,
      actorId: userId,
      projectId: issue.projectId,
      issueId,
      issueKey: issue.key,
    });

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
   * Assert that every foreign-key id on the create-issue payload points at
   * an entity inside the same project. Without this, Prisma happily accepts
   * an `epicId` from project B as the parent of an issue in project A —
   * the row exists, the FK is valid in isolation, but the relationship is
   * nonsense. Symptoms: subtask lists across projects, sprint counts that
   * don't match, the FE showing a parent that you can't navigate to.
   */
  private async assertIssueFkScope(
    dto: { parentId?: string; epicId?: string; sprintId?: string },
    projectId: string,
  ): Promise<void> {
    const [parent, epic, sprint] = await Promise.all([
      dto.parentId
        ? this.prisma.issue.findUnique({
            where: { id: dto.parentId },
            select: { projectId: true },
          })
        : Promise.resolve(null),
      dto.epicId
        ? this.prisma.issue.findUnique({
            where: { id: dto.epicId },
            select: { projectId: true },
          })
        : Promise.resolve(null),
      dto.sprintId
        ? this.prisma.sprint.findUnique({
            where: { id: dto.sprintId },
            select: { board: { select: { projectId: true } } },
          })
        : Promise.resolve(null),
    ]);

    if (dto.parentId && (!parent || parent.projectId !== projectId)) {
      throw new BadRequestException(MSG.ERROR.PARENT_NOT_IN_PROJECT);
    }
    if (dto.epicId && (!epic || epic.projectId !== projectId)) {
      throw new BadRequestException(MSG.ERROR.EPIC_NOT_IN_PROJECT);
    }
    if (dto.sprintId && (!sprint || sprint.board.projectId !== projectId)) {
      throw new BadRequestException(MSG.ERROR.SPRINT_NOT_IN_PROJECT);
    }
  }

  /**
   * Translate the FE's `customFields` filter map into Prisma `where` clauses.
   * Each entry becomes a `customFieldValues: { some: { fieldId, ...match } }`
   * combined under AND so filters compose. Definitions are loaded once to
   * coerce raw input strings into the right column (text/number/date/select).
   */
  private async buildCustomFieldClauses(
    projectId: string | undefined,
    raw: Record<string, string | string[]> | undefined,
  ): Promise<Prisma.IssueWhereInput[]> {
    if (!raw) return [];
    // Custom fields are project-scoped; the global search path doesn't
    // pick a project, so nothing to filter on.
    if (!projectId) return [];
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
      .catch((err) => {
        this.logger.warn(
          `webhook fanout: project lookup failed for issue=${issue.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      });
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

  findActivity(
    issueId: string,
    userId: string,
    opts?: { cursor?: string; take?: number },
  ) {
    return this.activityService.findActivity(issueId, userId, opts);
  }
}
