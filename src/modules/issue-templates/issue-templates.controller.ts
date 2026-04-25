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
import { CreateIssueTemplateDto, UpdateIssueTemplateDto } from './dto';
import { IssueTemplatesService } from './issue-templates.service';

const E = ENDPOINTS.ISSUE_TEMPLATES;

@ApiTags('Issue Templates')
@Controller(E.BASE)
export class IssueTemplatesController {
  constructor(private service: IssueTemplatesService) {}

  @Get()
  @ApiOperation({ summary: 'List issue templates for a project' })
  findAll(
    @Query('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.findAll(projectId, user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Create an issue template (admin/lead)' })
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateIssueTemplateDto,
  ) {
    const template = await this.service.create(user.id, dto);
    return { message: MSG.SUCCESS.ISSUE_TEMPLATE_CREATED, template };
  }

  @Patch(E.BY_ID)
  @ApiOperation({ summary: 'Update an issue template (admin/lead)' })
  async update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateIssueTemplateDto,
  ) {
    const template = await this.service.update(id, user.id, dto);
    return { message: MSG.SUCCESS.ISSUE_TEMPLATE_UPDATED, template };
  }

  @Delete(E.BY_ID)
  @ApiOperation({ summary: 'Delete an issue template (admin/lead)' })
  async delete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.service.delete(id, user.id);
    return { message: MSG.SUCCESS.ISSUE_TEMPLATE_DELETED };
  }
}
