import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ENDPOINTS, MSG } from '@/core/constants';
import { CurrentUser } from '@/core/decorators';
import { AuthUser } from '@/core/types';
import { CreateIssueDto, UpdateIssueDto, MoveIssueDto, BulkUpdateIssueDto, BulkDeleteIssueDto } from './dto';
import { IssuesService } from './issues.service';

const E = ENDPOINTS.ISSUES;

@ApiTags('Issues')
@Controller(E.BASE)
export class IssuesController {
  constructor(private issuesService: IssuesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new issue (auto-generates key)' })
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateIssueDto) {
    const issue = await this.issuesService.create(user.id, dto);
    return { message: MSG.SUCCESS.ISSUE_CREATED, issue };
  }

  @Get()
  @ApiOperation({ summary: 'List/filter issues by project' })
  findAll(
    @Query('projectId') projectId: string,
    @Query('sprintId') sprintId: string,
    @Query('assigneeId') assigneeId: string,
    @Query('type') type: string,
    @Query('priority') priority: string,
    @Query('search') search: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.issuesService.findAll(projectId, user.id, {
      sprintId,
      assigneeId,
      type,
      priority,
      search,
    });
  }

  @Get(E.BY_KEY)
  @ApiOperation({ summary: 'Get issue by key (e.g. PROJ-42)' })
  findByKey(@Param('key') key: string, @CurrentUser() user: AuthUser) {
    return this.issuesService.findByKey(key, user.id);
  }

  @Get(E.BY_ID)
  @ApiOperation({ summary: 'Get issue by ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.issuesService.findById(id, user.id);
  }

  @Patch(E.BY_ID)
  @ApiOperation({ summary: 'Update issue' })
  async update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateIssueDto,
  ) {
    const issue = await this.issuesService.update(id, user.id, dto);
    return { message: MSG.SUCCESS.ISSUE_UPDATED, issue };
  }

  @Patch(E.MOVE)
  @ApiOperation({ summary: 'Move issue to column (drag & drop)' })
  async move(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: MoveIssueDto,
  ) {
    const issue = await this.issuesService.move(id, user.id, dto);
    return { message: MSG.SUCCESS.ISSUE_MOVED, issue };
  }

  @Patch(E.BULK_UPDATE)
  @ApiOperation({ summary: 'Bulk update issues (sprint, assignee, priority)' })
  async bulkUpdate(@CurrentUser() user: AuthUser, @Body() dto: BulkUpdateIssueDto) {
    const result = await this.issuesService.bulkUpdate(user.id, dto);
    return { message: MSG.SUCCESS.ISSUE_UPDATED, ...result };
  }

  @Delete(E.BULK_DELETE)
  @ApiOperation({ summary: 'Bulk delete issues' })
  async bulkDelete(@CurrentUser() user: AuthUser, @Body() dto: BulkDeleteIssueDto) {
    const result = await this.issuesService.bulkDelete(user.id, dto.issueIds);
    return { message: MSG.SUCCESS.ISSUE_DELETED, ...result };
  }

  @Delete(E.BY_ID)
  @ApiOperation({ summary: 'Delete issue' })
  async delete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.issuesService.delete(id, user.id);
    return { message: MSG.SUCCESS.ISSUE_DELETED };
  }

  // ─── Labels ───────────────────────────────────────────

  @Post(E.LABEL_BY_ID)
  @ApiOperation({ summary: 'Add label to issue' })
  async addLabel(
    @Param('id') id: string,
    @Param('labelId') labelId: string,
    @CurrentUser() user: AuthUser,
  ) {
    const result = await this.issuesService.addLabel(id, labelId, user.id);
    return { message: MSG.SUCCESS.LABEL_ADDED, ...result };
  }

  @Delete(E.LABEL_BY_ID)
  @ApiOperation({ summary: 'Remove label from issue' })
  async removeLabel(
    @Param('id') id: string,
    @Param('labelId') labelId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.issuesService.removeLabel(id, labelId, user.id);
    return { message: MSG.SUCCESS.LABEL_REMOVED };
  }
}
