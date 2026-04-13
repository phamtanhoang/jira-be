import { Injectable, NotFoundException } from '@nestjs/common';
import { ActivityAction, IssueType, IssuePriority, Prisma, StatusCategory } from '@prisma/client';

const ACTIVITY_LIMIT = 20;
import { MSG, USER_SELECT_BASIC, BOARD_COLUMN_SELECT } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { WorkspacesService } from '@/modules/workspaces/workspaces.service';
import { CreateIssueDto, UpdateIssueDto, MoveIssueDto } from './dto';

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

@Injectable()
export class IssuesService {
  constructor(
    private prisma: PrismaService,
    private workspacesService: WorkspacesService,
  ) {}

  async create(userId: string, dto: CreateIssueDto) {
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
      include: { board: { include: { columns: { orderBy: { position: 'asc' }, take: 1 } } } },
    });
    if (!project) throw new NotFoundException(MSG.ERROR.PROJECT_NOT_FOUND);

    await this.workspacesService.assertMember(project.workspaceId, userId);

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
          description: dto.description,
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
        include: ISSUE_INCLUDE,
      });

      await tx.activity.create({
        data: {
          issueId: issue.id,
          userId,
          action: ActivityAction.CREATED,
        },
      });

      return issue;
    });
  }

  async findAll(projectId: string, userId: string, filters?: {
    sprintId?: string;
    assigneeId?: string;
    type?: string;
    priority?: string;
    search?: string;
  }) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException(MSG.ERROR.PROJECT_NOT_FOUND);

    await this.workspacesService.assertMember(project.workspaceId, userId);

    return this.prisma.issue.findMany({
      where: {
        projectId,
        ...(filters?.sprintId && { sprintId: filters.sprintId }),
        ...(filters?.sprintId === 'backlog' && { sprintId: null }),
        ...(filters?.assigneeId && { assigneeId: filters.assigneeId }),
        ...(filters?.type && { type: filters.type as IssueType }),
        ...(filters?.priority && { priority: filters.priority as IssuePriority }),
        ...(filters?.search && {
          OR: [
            { summary: { contains: filters.search, mode: Prisma.QueryMode.insensitive } },
            { key: { contains: filters.search, mode: Prisma.QueryMode.insensitive } },
          ],
        }),
      },
      include: ISSUE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByKey(key: string, userId: string) {
    const issue = await this.prisma.issue.findUnique({
      where: { key },
      include: {
        ...ISSUE_INCLUDE,
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
      },
    });
    if (!issue) throw new NotFoundException(MSG.ERROR.ISSUE_NOT_FOUND);

    const project = await this.prisma.project.findUnique({ where: { id: issue.projectId } });
    await this.workspacesService.assertMember(project!.workspaceId, userId);

    return issue;
  }

  async findById(issueId: string, userId: string) {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      include: ISSUE_INCLUDE,
    });
    if (!issue) throw new NotFoundException(MSG.ERROR.ISSUE_NOT_FOUND);

    const project = await this.prisma.project.findUnique({ where: { id: issue.projectId } });
    await this.workspacesService.assertMember(project!.workspaceId, userId);

    return issue;
  }

  async update(issueId: string, userId: string, dto: UpdateIssueDto) {
    const issue = await this.findById(issueId, userId);

    const data: Record<string, unknown> = {};
    const activities: { field: string; oldValue: string | null; newValue: string | null }[] = [];

    for (const [field, value] of Object.entries(dto)) {
      if (value === undefined) continue;
      const oldVal = (issue as Record<string, unknown>)[field];
      if (field === 'dueDate' || field === 'startDate') {
        data[field] = value ? new Date(value as string) : null;
      } else {
        data[field] = value;
      }
      activities.push({
        field,
        oldValue: oldVal != null ? String(oldVal) : null,
        newValue: value != null ? String(value) : null,
      });
    }

    const updated = await this.prisma.issue.update({
      where: { id: issueId },
      data,
      include: ISSUE_INCLUDE,
    });

    // Log activities
    if (activities.length > 0) {
      await this.prisma.activity.createMany({
        data: activities.map((a) => ({
          issueId,
          userId,
          action: a.field === 'assigneeId' ? ActivityAction.ASSIGNED : ActivityAction.UPDATED,
          field: a.field,
          oldValue: a.oldValue,
          newValue: a.newValue,
        })),
      });
    }

    return updated;
  }

  async move(issueId: string, userId: string, dto: MoveIssueDto) {
    const issue = await this.findById(issueId, userId);

    const column = await this.prisma.boardColumn.findUnique({ where: { id: dto.columnId } });
    if (!column) throw new NotFoundException(MSG.ERROR.COLUMN_NOT_FOUND);

    const oldColumnId = issue.boardColumnId;

    const updated = await this.prisma.issue.update({
      where: { id: issueId },
      data: {
        boardColumnId: dto.columnId,
        position: dto.position ?? 0,
        completedAt: column.category === StatusCategory.DONE ? new Date() : null,
      },
      include: ISSUE_INCLUDE,
    });

    // Log transition
    if (oldColumnId !== dto.columnId) {
      const oldColumn = oldColumnId
        ? await this.prisma.boardColumn.findUnique({ where: { id: oldColumnId } })
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
    }

    return updated;
  }

  async delete(issueId: string, userId: string) {
    await this.findById(issueId, userId);
    return this.prisma.issue.delete({ where: { id: issueId } });
  }

  // ─── Bulk Operations ──────────────────────────────────

  async bulkUpdate(
    userId: string,
    dto: { issueIds: string[]; sprintId?: string | null; assigneeId?: string | null; priority?: string },
  ) {
    // Verify access for first issue (all should be in same project)
    const firstIssue = await this.findById(dto.issueIds[0], userId);

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
