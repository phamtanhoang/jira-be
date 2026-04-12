import { Injectable, NotFoundException } from '@nestjs/common';
import { ActivityAction, StatusCategory } from '@prisma/client';
import { MSG } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { WorkspacesService } from '@/modules/workspaces/workspaces.service';
import { CreateIssueDto, UpdateIssueDto, MoveIssueDto } from './dto';

const ISSUE_INCLUDE = {
  reporter: { select: { id: true, name: true, image: true } },
  assignee: { select: { id: true, name: true, image: true } },
  boardColumn: { select: { id: true, name: true, category: true } },
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

    // Generate issue key atomically
    const updated = await this.prisma.project.update({
      where: { id: project.id },
      data: { issueCounter: { increment: 1 } },
    });
    const key = `${project.key}-${updated.issueCounter}`;

    // Default to first column (To Do)
    const firstColumnId = project.board?.columns[0]?.id;

    const issue = await this.prisma.issue.create({
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

    // Log activity
    await this.prisma.activity.create({
      data: {
        issueId: issue.id,
        userId,
        action: ActivityAction.CREATED,
      },
    });

    return issue;
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
        ...(filters?.type && { type: filters.type as any }),
        ...(filters?.priority && { priority: filters.priority as any }),
        ...(filters?.search && {
          OR: [
            { summary: { contains: filters.search, mode: 'insensitive' as any } },
            { key: { contains: filters.search, mode: 'insensitive' as any } },
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
            assignee: { select: { id: true, name: true, image: true } },
            boardColumn: { select: { id: true, name: true, category: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        comments: {
          include: { author: { select: { id: true, name: true, image: true } } },
          orderBy: { createdAt: 'asc' },
        },
        activities: {
          include: { user: { select: { id: true, name: true, image: true } } },
          orderBy: { createdAt: 'desc' },
          take: 20,
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
      const oldVal = (issue as any)[field];
      if (field === 'dueDate') {
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
