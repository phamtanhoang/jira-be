import { Injectable, forwardRef, Inject } from '@nestjs/common';
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
    await this.issuesService.findById(issueId, userId);

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
