import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { BOARD_COLUMN_SELECT, USER_SELECT_BASIC } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import {
  IssueNotFoundException,
  ShareTokenExpiredException,
  ShareTokenNotFoundException,
} from '@/core/exceptions';
import { generateShareToken } from '@/core/utils';
import { IssuesService } from '../issues.service';

@Injectable()
export class IssuesShareService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => IssuesService))
    private issuesService: IssuesService,
  ) {}

  /**
   * Mint a fresh share token. Caller must be a project member — token grants
   * read-only access to anyone with the URL, so we gate creation, not reads.
   */
  async createShareToken(
    issueId: string,
    userId: string,
    opts?: { expiresInSec?: number },
  ) {
    await this.issuesService.findById(issueId, userId);
    const token = generateShareToken();
    const expiresAt =
      opts?.expiresInSec && opts.expiresInSec > 0
        ? new Date(Date.now() + opts.expiresInSec * 1000)
        : null;
    return this.prisma.issueShareToken.create({
      data: { issueId, createdById: userId, token, expiresAt },
    });
  }

  async listShareTokens(issueId: string, userId: string) {
    await this.issuesService.findById(issueId, userId);
    return this.prisma.issueShareToken.findMany({
      where: { issueId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeShareToken(issueId: string, tokenId: string, userId: string) {
    await this.issuesService.findById(issueId, userId);
    const tok = await this.prisma.issueShareToken.findUnique({
      where: { id: tokenId },
    });
    if (!tok || tok.issueId !== issueId) {
      throw new ShareTokenNotFoundException();
    }
    await this.prisma.issueShareToken.delete({ where: { id: tokenId } });
  }

  /**
   * Public — no auth. Returns a slimmed-down issue suitable for a read-only
   * page. Bumps viewCount fire-and-forget so it doesn't add latency to the
   * public read path.
   */
  async findByShareToken(token: string) {
    const tok = await this.prisma.issueShareToken.findUnique({
      where: { token },
    });
    if (!tok) throw new ShareTokenNotFoundException();
    if (tok.expiresAt && tok.expiresAt < new Date()) {
      throw new ShareTokenExpiredException();
    }

    const issue = await this.prisma.issue.findUnique({
      where: { id: tok.issueId },
      // Keep author/assignee names but drop emails. Skip worklogs entirely
      // — those carry hours/cost data that shouldn't leak via a copy-pasted
      // link.
      include: {
        reporter: USER_SELECT_BASIC,
        assignee: USER_SELECT_BASIC,
        boardColumn: BOARD_COLUMN_SELECT,
        labels: { include: { label: true } },
        comments: {
          include: { author: USER_SELECT_BASIC },
          orderBy: { createdAt: 'asc' },
        },
        attachments: {
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            fileSize: true,
            createdAt: true,
          },
        },
      },
    });
    if (!issue) throw new IssueNotFoundException();

    void this.prisma.issueShareToken
      .update({
        where: { id: tok.id },
        data: { viewCount: { increment: 1 } },
      })
      .catch(() => null);

    return issue;
  }
}
