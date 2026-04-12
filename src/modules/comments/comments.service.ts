import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ActivityAction } from '@prisma/client';
import { MSG } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { CreateCommentDto, UpdateCommentDto } from './dto';

const AUTHOR_SELECT = { id: true, name: true, image: true };

@Injectable()
export class CommentsService {
  constructor(private prisma: PrismaService) {}

  async create(issueId: string, userId: string, dto: CreateCommentDto) {
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId } });
    if (!issue) throw new NotFoundException(MSG.ERROR.ISSUE_NOT_FOUND);

    const comment = await this.prisma.comment.create({
      data: {
        issueId,
        authorId: userId,
        content: dto.content,
        parentId: dto.parentId,
      },
      include: {
        author: { select: AUTHOR_SELECT },
        replies: { include: { author: { select: AUTHOR_SELECT } } },
      },
    });

    await this.prisma.activity.create({
      data: {
        issueId,
        userId,
        action: ActivityAction.COMMENTED,
      },
    });

    return comment;
  }

  async findByIssue(issueId: string) {
    return this.prisma.comment.findMany({
      where: { issueId, parentId: null },
      include: {
        author: { select: AUTHOR_SELECT },
        replies: {
          include: { author: { select: AUTHOR_SELECT } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async update(commentId: string, userId: string, dto: UpdateCommentDto) {
    const comment = await this.prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment) throw new NotFoundException(MSG.ERROR.COMMENT_NOT_FOUND);
    if (comment.authorId !== userId) throw new ForbiddenException(MSG.ERROR.NOT_AUTHOR);

    return this.prisma.comment.update({
      where: { id: commentId },
      data: { content: dto.content },
      include: { author: { select: AUTHOR_SELECT } },
    });
  }

  async delete(commentId: string, userId: string) {
    const comment = await this.prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment) throw new NotFoundException(MSG.ERROR.COMMENT_NOT_FOUND);
    if (comment.authorId !== userId) throw new ForbiddenException(MSG.ERROR.NOT_AUTHOR);

    return this.prisma.comment.delete({ where: { id: commentId } });
  }
}
