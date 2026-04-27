import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ENDPOINTS, MSG } from '@/core/constants';
import { CurrentUser } from '@/core/decorators';
import { AuthUser } from '@/core/types';
import {
  CreateIssueDto,
  UpdateIssueDto,
  MoveIssueDto,
  BulkUpdateIssueDto,
  BulkDeleteIssueDto,
  CreateIssueLinkDto,
} from './dto';
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
  // Board/backlog views refetch this endpoint often (filters, sprints,
  // search). It's already gated by workspace membership, so skip the
  // global throttle to keep quick-filter UX snappy.
  @SkipThrottle()
  @ApiOperation({
    summary: 'List/filter issues by project. Add take & cursor for pagination.',
  })
  findAll(
    @Query('projectId') projectId: string,
    @Query('sprintId') sprintId: string,
    @Query('assigneeId') assigneeId: string,
    @Query('type') type: string,
    @Query('priority') priority: string,
    @Query('search') search: string,
    @Query('cursor') cursor: string,
    @Query('take') take: string,
    @Query('customFields') customFields: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.issuesService.findAll(projectId, user.id, {
      sprintId,
      assigneeId,
      type,
      priority,
      search,
      cursor,
      take: take ? parseInt(take) : undefined,
      customFields: parseCustomFieldsQuery(customFields),
    });
  }

  @Get('me/dashboard')
  @ApiOperation({
    summary:
      'Current user dashboard: assigned open issues, overdue, due-soon, and recent activity across all workspaces the user belongs to.',
  })
  findMyDashboard(@CurrentUser() user: AuthUser) {
    return this.issuesService.findMyDashboard(user.id);
  }

  @Get(E.EXPORT_CSV)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="issues.csv"')
  @ApiOperation({ summary: 'Export project issues as CSV' })
  exportCsv(
    @Query('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.issuesService.exportCsv(projectId, user.id);
  }

  @Get(E.STARRED)
  @ApiOperation({ summary: 'IDs of issues starred by current user' })
  findStarredIds(
    @CurrentUser() user: AuthUser,
    @Query('projectId') projectId?: string,
  ) {
    return this.issuesService
      .findStarredIds(user.id, projectId)
      .then((issueIds) => ({ issueIds }));
  }

  @Post(E.STAR)
  @ApiOperation({ summary: 'Star an issue (favorite)' })
  async addStar(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const result = await this.issuesService.star(id, user.id);
    return { message: MSG.SUCCESS.ISSUE_STARRED, ...result };
  }

  @Delete(E.STAR)
  @ApiOperation({ summary: 'Remove star from an issue' })
  async removeStar(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const result = await this.issuesService.unstar(id, user.id);
    return { message: MSG.SUCCESS.ISSUE_UNSTARRED, ...result };
  }

  // ─── Watch / Subscribe ─────────────────────────────────

  @Post(E.WATCH)
  @ApiOperation({ summary: 'Watch (subscribe to notifications for) an issue' })
  async watch(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const result = await this.issuesService.watch(id, user.id);
    return { message: MSG.SUCCESS.ISSUE_WATCHED, ...result };
  }

  @Delete(E.WATCH)
  @ApiOperation({ summary: 'Stop watching an issue' })
  async unwatch(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const result = await this.issuesService.unwatch(id, user.id);
    return { message: MSG.SUCCESS.ISSUE_UNWATCHED, ...result };
  }

  @Get(E.WATCHERS)
  @ApiOperation({ summary: 'List users watching this issue' })
  findWatchers(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.issuesService
      .findWatchers(id, user.id)
      .then((watchers) => ({ watchers }));
  }

  // ─── Share tokens (public read-only links) ─────────────

  @Get(E.SHARE)
  @ApiOperation({ summary: 'List active share tokens for this issue' })
  listShareTokens(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.issuesService
      .listShareTokens(id, user.id)
      .then((tokens) => ({ tokens }));
  }

  @Post(E.SHARE)
  @ApiOperation({ summary: 'Create a public share token for this issue' })
  async createShareToken(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: { expiresInSec?: number },
  ) {
    const token = await this.issuesService.createShareToken(id, user.id, dto);
    return { message: MSG.SUCCESS.SHARE_TOKEN_CREATED, token };
  }

  @Delete(E.SHARE_BY_ID)
  @ApiOperation({ summary: 'Revoke a share token' })
  async revokeShareToken(
    @Param('id') id: string,
    @Param('tokenId') tokenId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.issuesService.revokeShareToken(id, tokenId, user.id);
    return { message: MSG.SUCCESS.SHARE_TOKEN_REVOKED };
  }

  // ─── Issue Links ───────────────────────────────────────

  @Post(E.LINKS)
  @ApiOperation({ summary: 'Create a typed link from this issue to another' })
  async createLink(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateIssueLinkDto,
  ) {
    const link = await this.issuesService.createLink(id, user.id, dto);
    return { message: MSG.SUCCESS.ISSUE_LINK_CREATED, link };
  }

  @Delete(E.LINK_BY_ID)
  @ApiOperation({ summary: 'Delete an issue link from either end' })
  async deleteLink(
    @Param('id') id: string,
    @Param('linkId') linkId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.issuesService.deleteLink(id, linkId, user.id);
    return { message: MSG.SUCCESS.ISSUE_LINK_DELETED };
  }

  @Get(E.BY_KEY)
  @ApiOperation({ summary: 'Get issue by key (e.g. PROJ-42)' })
  findByKey(@Param('key') key: string, @CurrentUser() user: AuthUser) {
    return this.issuesService.findByKey(key, user.id);
  }

  @Get(E.ACTIVITY)
  // Opening / closing an issue modal re-fetches activity. Skip throttle
  // — workspace membership check is enough.
  @SkipThrottle()
  @ApiOperation({ summary: 'Get activity log for issue' })
  findActivity(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.issuesService.findActivity(id, user.id);
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
  async bulkUpdate(
    @CurrentUser() user: AuthUser,
    @Body() dto: BulkUpdateIssueDto,
  ) {
    const result = await this.issuesService.bulkUpdate(user.id, dto);
    return { message: MSG.SUCCESS.ISSUE_UPDATED, ...result };
  }

  @Delete(E.BULK_DELETE)
  @ApiOperation({ summary: 'Bulk delete issues' })
  async bulkDelete(
    @CurrentUser() user: AuthUser,
    @Body() dto: BulkDeleteIssueDto,
  ) {
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

/**
 * Decode the `customFields` query param. FE sends a JSON-encoded
 * `Record<fieldId, string | string[]>`. Unparsable input is treated as no
 * filter so a malformed query never 500s on a list endpoint.
 */
function parseCustomFieldsQuery(
  raw: string | undefined,
): Record<string, string | string[]> | undefined {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    const out: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') {
        out[k] = v;
      } else if (
        Array.isArray(v) &&
        v.every((item) => typeof item === 'string')
      ) {
        out[k] = v as string[];
      }
    }
    return Object.keys(out).length ? out : undefined;
  } catch {
    return undefined;
  }
}
