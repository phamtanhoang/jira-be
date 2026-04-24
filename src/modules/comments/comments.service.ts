import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityAction } from '@prisma/client';
import { MSG, USER_SELECT_BASIC } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { assertProjectAccess } from '@/core/utils';
import { CreateCommentDto, UpdateCommentDto } from './dto';

@Injectable()
export class CommentsService {
  constructor(private prisma: PrismaService) {}

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

    const comment = await this.prisma.comment.create({
      data: {
        issueId,
        authorId: userId,
        content: dto.content,
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
      data: { content: dto.content },
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
