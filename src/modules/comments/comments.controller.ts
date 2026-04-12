import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ENDPOINTS, MSG } from '@/core/constants';
import { CurrentUser } from '@/core/decorators';
import { AuthUser } from '@/core/types';
import { CreateCommentDto, UpdateCommentDto } from './dto';
import { CommentsService } from './comments.service';

@ApiTags('Comments')
@Controller(ENDPOINTS.ISSUES.BASE)
export class CommentsController {
  constructor(private commentsService: CommentsService) {}

  @Post(ENDPOINTS.ISSUES.COMMENTS)
  @ApiOperation({ summary: 'Create comment on issue' })
  async create(
    @Param('id') issueId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCommentDto,
  ) {
    const comment = await this.commentsService.create(issueId, user.id, dto);
    return { message: MSG.SUCCESS.COMMENT_CREATED, comment };
  }

  @Get(ENDPOINTS.ISSUES.COMMENTS)
  @ApiOperation({ summary: 'List comments on issue (threaded)' })
  findAll(@Param('id') issueId: string) {
    return this.commentsService.findByIssue(issueId);
  }
}

@ApiTags('Comments')
@Controller(ENDPOINTS.COMMENTS.BASE)
export class CommentsManageController {
  constructor(private commentsService: CommentsService) {}

  @Patch(ENDPOINTS.COMMENTS.BY_ID)
  @ApiOperation({ summary: 'Update own comment' })
  async update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateCommentDto,
  ) {
    const comment = await this.commentsService.update(id, user.id, dto);
    return { message: MSG.SUCCESS.COMMENT_UPDATED, comment };
  }

  @Delete(ENDPOINTS.COMMENTS.BY_ID)
  @ApiOperation({ summary: 'Delete own comment' })
  async delete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.commentsService.delete(id, user.id);
    return { message: MSG.SUCCESS.COMMENT_DELETED };
  }
}
