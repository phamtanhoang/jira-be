import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityAction } from '@prisma/client';
import { MSG, USER_SELECT_BASIC } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import {
  assertProjectAccess,
  extractMentions,
  sanitizeRichHtml,
} from '@/core/utils';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { CreateCommentDto, UpdateCommentDto } from './dto';

@Injectable()
export class CommentsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  async create(issueId: string, userId: string, dto: CreateCommentDto) {
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

    const safeContent = sanitizeRichHtml(dto.content);

    const comment = await this.prisma.comment.create({
      data: {
        issueId,
        authorId: userId,
        content: safeContent,
        parentId: dto.parentId,
      },
      include: {
        author: USER_SELECT_BASIC,
        replies: { include: { author: USER_SELECT_BASIC } },
      },
    });

    await this.prisma.activity.create({
      data: {
        issueId,
        userId,
        action: ActivityAction.COMMENTED,
      },
    });

    // Fan-out: reporter + assignee + watchers, minus the comment author.
    const watcherRows = await this.prisma.issueWatcher.findMany({
      where: { issueId },
      select: { userId: true },
    });
    const baseRecipients = [
      issue.reporterId,
      issue.assigneeId,
      ...watcherRows.map((w) => w.userId),
    ].filter((id): id is string => !!id && id !== userId);
    const baseSet = new Set(baseRecipients);

    this.notifications.createMany(baseRecipients, {
      type: 'COMMENT_CREATED',
      title: `New comment on ${issue.key}`,
      body: stripHtmlPreview(safeContent),
      link: `/issues/${issue.key}`,
    });

    // Auto-subscribe the commenter — keeps them in the loop on subsequent
    // activity. Idempotent upsert; failure is silently ignored.
    void this.prisma.issueWatcher
      .upsert({
        where: { issueId_userId: { issueId, userId } },
        update: {},
        create: { issueId, userId },
      })
      .catch(() => null);

    // Mentions get a separate, stronger notification — but only for people
    // NOT already covered by the base fan-out (avoid duplicate pings).
    const mentionedIds = extractMentions(safeContent).filter(
      (id) => id !== userId && !baseSet.has(id),
    );
    this.notifications.createMany(mentionedIds, {
      type: 'MENTION_COMMENT',
      title: `You were mentioned on ${issue.key}`,
      body: stripHtmlPreview(safeContent),
      link: `/issues/${issue.key}`,
    });

    return comment;
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

    return this.prisma.comment.findMany({
      where: { issueId, parentId: null },
      include: {
        author: USER_SELECT_BASIC,
        replies: {
          include: { author: USER_SELECT_BASIC },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async update(commentId: string, userId: string, dto: UpdateCommentDto) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
    });
    if (!comment) throw new NotFoundException(MSG.ERROR.COMMENT_NOT_FOUND);
    if (comment.authorId !== userId)
      throw new ForbiddenException(MSG.ERROR.NOT_AUTHOR);

    return this.prisma.comment.update({
      where: { id: commentId },
      data: { content: sanitizeRichHtml(dto.content) },
      include: { author: USER_SELECT_BASIC },
    });
  }

  async delete(commentId: string, userId: string) {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
    });
    if (!comment) throw new NotFoundException(MSG.ERROR.COMMENT_NOT_FOUND);
    if (comment.authorId !== userId)
      throw new ForbiddenException(MSG.ERROR.NOT_AUTHOR);

    return this.prisma.comment.delete({ where: { id: commentId } });
  }
}

// Cheap one-line preview for notification bodies. Strip HTML tags, collapse
// whitespace, cap at 140 chars. Doesn't need to be perfect — it's a teaser.
function stripHtmlPreview(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}
