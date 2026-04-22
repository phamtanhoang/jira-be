import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ENDPOINTS, MSG } from '@/core/constants';
import { CurrentUser } from '@/core/decorators';
import { AuthUser } from '@/core/types';
import { CreateWorklogDto, UpdateWorklogDto } from './dto';
import { WorklogsService } from './worklogs.service';

@ApiTags('Worklogs')
@Controller(ENDPOINTS.ISSUES.BASE)
export class WorklogsIssueController {
  constructor(private worklogsService: WorklogsService) {}

  @Post(ENDPOINTS.ISSUES.WORKLOGS)
  @ApiOperation({ summary: 'Log work on issue' })
  async create(
    @Param('id') issueId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateWorklogDto,
  ) {
    const worklog = await this.worklogsService.create(issueId, user.id, dto);
    return { message: MSG.SUCCESS.WORKLOG_CREATED, worklog };
  }

  @Get(ENDPOINTS.ISSUES.WORKLOGS)
  @ApiOperation({ summary: 'List worklogs for issue' })
  findAll(@Param('id') issueId: string) {
    return this.worklogsService.findByIssue(issueId);
  }
}

@ApiTags('Worklogs')
@Controller(ENDPOINTS.WORKLOGS.BASE)
export class WorklogsManageController {
  constructor(private worklogsService: WorklogsService) {}

  @Patch(ENDPOINTS.WORKLOGS.BY_ID)
  @ApiOperation({ summary: 'Update own worklog' })
  async update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateWorklogDto,
  ) {
    const worklog = await this.worklogsService.update(id, user.id, dto);
    return { message: MSG.SUCCESS.WORKLOG_UPDATED, worklog };
  }

  @Delete(ENDPOINTS.WORKLOGS.BY_ID)
  @ApiOperation({ summary: 'Delete own worklog' })
  async delete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.worklogsService.delete(id, user.id);
    return { message: MSG.SUCCESS.WORKLOG_DELETED };
  }
}
