import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { IssueLinkType, Prisma } from '@prisma/client';
import { MSG } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { IssuesService } from '../issues.service';
import { ISSUE_LINK_PEER_SELECT } from '../issues.shared';

@Injectable()
export class IssuesLinksService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => IssuesService))
    private issuesService: IssuesService,
  ) {}

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
    await this.issuesService.findById(sourceIssueId, userId);
    await this.issuesService.findById(dto.targetIssueId, userId);

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
    await this.issuesService.findById(issueId, userId);
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
}
