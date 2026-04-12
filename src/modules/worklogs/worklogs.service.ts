import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ActivityAction } from '@prisma/client';
import { MSG, USER_SELECT_BASIC } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { CreateWorklogDto, UpdateWorklogDto } from './dto';

@Injectable()
export class WorklogsService {
  constructor(private prisma: PrismaService) {}

  async create(issueId: string, userId: string, dto: CreateWorklogDto) {
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId } });
    if (!issue) throw new NotFoundException(MSG.ERROR.ISSUE_NOT_FOUND);

    const worklog = await this.prisma.worklog.create({
      data: {
        issueId,
        userId,
        timeSpent: dto.timeSpent,
        startedAt: new Date(dto.startedAt),
        description: dto.description,
      },
      include: { user: USER_SELECT_BASIC },
    });

    await this.prisma.activity.create({
      data: {
        issueId,
        userId,
        action: ActivityAction.LOGGED_WORK,
        newValue: `${dto.timeSpent}s`,
      },
    });

    return worklog;
  }

  async findByIssue(issueId: string) {
    return this.prisma.worklog.findMany({
      where: { issueId },
      include: { user: USER_SELECT_BASIC },
      orderBy: { startedAt: 'desc' },
    });
  }

  async update(worklogId: string, userId: string, dto: UpdateWorklogDto) {
    const worklog = await this.prisma.worklog.findUnique({ where: { id: worklogId } });
    if (!worklog) throw new NotFoundException(MSG.ERROR.WORKLOG_NOT_FOUND);
    if (worklog.userId !== userId) throw new ForbiddenException(MSG.ERROR.NOT_AUTHOR);

    return this.prisma.worklog.update({
      where: { id: worklogId },
      data: {
        ...(dto.timeSpent !== undefined && { timeSpent: dto.timeSpent }),
        ...(dto.startedAt !== undefined && { startedAt: new Date(dto.startedAt) }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
      include: { user: USER_SELECT_BASIC },
    });
  }

  async delete(worklogId: string, userId: string) {
    const worklog = await this.prisma.worklog.findUnique({ where: { id: worklogId } });
    if (!worklog) throw new NotFoundException(MSG.ERROR.WORKLOG_NOT_FOUND);
    if (worklog.userId !== userId) throw new ForbiddenException(MSG.ERROR.NOT_AUTHOR);

    return this.prisma.worklog.delete({ where: { id: worklogId } });
  }
}
