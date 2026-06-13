import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { BOARD_COLUMN_SELECT, USER_SELECT_BASIC } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import {
  IssueNotFoundException,
  ShareTokenExpiredException,
  ShareTokenNotFoundException,
} from '@/core/exceptions';
import { createSignedUrl, generateShareToken } from '@/core/utils';
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
            fileUrl: true,
            createdAt: true,
          },
        },
        // Surface basic sprint/epic identity so the guest can see context
        // ("this issue is part of Sprint 12, Epic Mobile MVP") without
        // exposing the full sprint/epic detail behind those names.
        sprint: { select: { id: true, name: true, status: true } },
        epic: { select: { id: true, key: true, summary: true } },
        parent: { select: { id: true, key: true, summary: true } },
      },
    });
    if (!issue) throw new IssueNotFoundException();

    // Enrich attachments with short-TTL signed URLs (5 min). The guest
    // gets a viewable URL but can't bookmark/leak it long term — a
    // reload generates a fresh URL. fileUrl itself is stripped from
    // the response so the underlying storage path never reaches the
    // browser.
    const ATTACHMENT_TTL_SEC = 300;
    const enrichedAttachments = await Promise.all(
      (issue.attachments ?? []).map(async (a) => {
        const signedUrl = await createSignedUrl(a.fileUrl, ATTACHMENT_TTL_SEC);
        // Strip fileUrl from the response — guest only ever sees the
        // signed URL. `fileUrl` is the raw storage path used for our
        // own delete/move operations.
        const { fileUrl: _fileUrl, ...rest } = a;
        void _fileUrl;
        return { ...rest, signedUrl: signedUrl ?? null };
      }),
    );

    void this.prisma.issueShareToken
      .update({
        where: { id: tok.id },
        data: { viewCount: { increment: 1 } },
      })
      .catch(() => null);

    return { ...issue, attachments: enrichedAttachments };
  }
}
