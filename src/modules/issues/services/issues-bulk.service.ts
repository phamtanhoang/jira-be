import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { PrismaService } from '@/core/database/prisma.service';
import { IssuesService } from '../issues.service';

@Injectable()
export class IssuesBulkService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => IssuesService))
    private issuesService: IssuesService,
  ) {}

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
    await this.issuesService.findById(dto.issueIds[0], userId);

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
    await this.issuesService.findById(issueIds[0], userId);

    const result = await this.prisma.issue.deleteMany({
      where: { id: { in: issueIds } },
    });

    return { count: result.count };
  }
}
