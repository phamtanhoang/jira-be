import {
  BadRequestException,
  Injectable,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { MSG } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { IssuesService } from '../issues.service';

@Injectable()
export class IssuesLabelsService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => IssuesService))
    private issuesService: IssuesService,
  ) {}

  async addLabel(issueId: string, labelId: string, userId: string) {
    const issue = await this.issuesService.findById(issueId, userId);

    // Labels are project-scoped (`@@unique([projectId, name])`). Without
    // this check the caller can attach a label from project B to an issue
    // in project A — the FK is technically valid but the relationship is
    // nonsense and pollutes the issue's label list with strangers.
    const label = await this.prisma.label.findUnique({
      where: { id: labelId },
      select: { projectId: true },
    });
    if (!label || label.projectId !== issue.projectId) {
      throw new BadRequestException(MSG.ERROR.LABEL_NOT_IN_PROJECT);
    }

    return this.prisma.issueLabel.create({
      data: { issueId, labelId },
      include: { label: true },
    });
  }

  async removeLabel(issueId: string, labelId: string, userId: string) {
    await this.issuesService.findById(issueId, userId);

    return this.prisma.issueLabel.delete({
      where: { issueId_labelId: { issueId, labelId } },
    });
  }
}
