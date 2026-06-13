import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityAction } from '@prisma/client';
import { MSG, USER_SELECT_BASIC } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { assertProjectAccess } from '@/core/utils';
import { RealtimeEventsService } from '@/modules/events/events.service';
import { REALTIME_EVENTS } from '@/modules/events/events.types';
import { CreateWorklogDto, UpdateWorklogDto } from './dto';

@Injectable()
export class WorklogsService {
  constructor(
    private prisma: PrismaService,
    private realtime: RealtimeEventsService,
  ) {}

  private emit(projectId: string, issueId: string, actorId: string) {
    this.realtime.emit({
      type: REALTIME_EVENTS.WORKLOG_CHANGED,
      actorId,
      projectId,
      issueId,
    });
  }

  async create(issueId: string, userId: string, dto: CreateWorklogDto) {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      include: { project: { select: { id: true, workspaceId: true } } },
    });
    if (!issue) throw new NotFoundException(MSG.ERROR.ISSUE_NOT_FOUND);
    await assertProjectAccess(
      this.prisma,
      issue.project.workspaceId,
      issue.project.id,
      userId,
    );

    // Worklog + activity commit together. A crash between the two would
    // either inflate billing reports (worklog without audit) or hide work
    // (activity without underlying worklog).
    const result = await this.prisma.$transaction(async (tx) => {
      const worklog = await tx.worklog.create({
        data: {
          issueId,
          userId,
          timeSpent: dto.timeSpent,
          startedAt: new Date(dto.startedAt),
          description: dto.description,
        },
        include: { user: USER_SELECT_BASIC },
      });
      await tx.activity.create({
        data: {
          issueId,
          userId,
          action: ActivityAction.LOGGED_WORK,
          newValue: `${dto.timeSpent}s`,
        },
      });
      return worklog;
    });
    this.emit(issue.project.id, issueId, userId);
    return result;
  }

  async findByIssue(issueId: string, userId: string) {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      include: { project: { select: { id: true, workspaceId: true } } },
    });
    if (!issue) throw new NotFoundException(MSG.ERROR.ISSUE_NOT_FOUND);
    await assertProjectAccess(
      this.prisma,
      issue.project.workspaceId,
      issue.project.id,
      userId,
    );

    return this.prisma.worklog.findMany({
      where: { issueId },
      include: { user: USER_SELECT_BASIC },
      orderBy: { startedAt: 'desc' },
    });
  }

  async update(worklogId: string, userId: string, dto: UpdateWorklogDto) {
    const worklog = await this.prisma.worklog.findUnique({
      where: { id: worklogId },
      include: {
        issue: {
          select: { project: { select: { id: true, workspaceId: true } } },
        },
      },
    });
    if (!worklog) throw new NotFoundException(MSG.ERROR.WORKLOG_NOT_FOUND);
    // Workspace-access check before author check: a user removed from
    // the workspace must not be able to edit their old worklogs.
    await assertProjectAccess(
      this.prisma,
      worklog.issue.project.workspaceId,
      worklog.issue.project.id,
      userId,
    );
    if (worklog.userId !== userId)
      throw new ForbiddenException(MSG.ERROR.NOT_AUTHOR);

    const updated = await this.prisma.worklog.update({
      where: { id: worklogId },
      data: {
        ...(dto.timeSpent !== undefined && { timeSpent: dto.timeSpent }),
        ...(dto.startedAt !== undefined && {
          startedAt: new Date(dto.startedAt),
        }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
      include: { user: USER_SELECT_BASIC },
    });
    this.emit(worklog.issue.project.id, worklog.issueId, userId);
    return updated;
  }

  async delete(worklogId: string, userId: string) {
    const worklog = await this.prisma.worklog.findUnique({
      where: { id: worklogId },
      include: {
        issue: {
          select: { project: { select: { id: true, workspaceId: true } } },
        },
      },
    });
    if (!worklog) throw new NotFoundException(MSG.ERROR.WORKLOG_NOT_FOUND);
    await assertProjectAccess(
      this.prisma,
      worklog.issue.project.workspaceId,
      worklog.issue.project.id,
      userId,
    );
    if (worklog.userId !== userId)
      throw new ForbiddenException(MSG.ERROR.NOT_AUTHOR);

    const result = await this.prisma.worklog.delete({
      where: { id: worklogId },
    });
    this.emit(worklog.issue.project.id, worklog.issueId, userId);
    return result;
  }
}
