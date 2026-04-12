import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ENDPOINTS, MSG } from '@/core/constants';
import { CurrentUser } from '@/core/decorators';
import { AuthUser } from '@/core/types';
import { CreateLabelDto } from './dto';
import { LabelsService } from './labels.service';

const E = ENDPOINTS.LABELS;

@ApiTags('Labels')
@Controller(E.BASE)
export class LabelsController {
  constructor(private labelsService: LabelsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a label for a project' })
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateLabelDto) {
    const label = await this.labelsService.create(user.id, dto);
    return { message: MSG.SUCCESS.LABEL_CREATED, label };
  }

  @Get()
  @ApiOperation({ summary: 'List labels by project' })
  findAll(@Query('projectId') projectId: string, @CurrentUser() user: AuthUser) {
    return this.labelsService.findAllByProject(projectId, user.id);
  }

  @Delete(E.BY_ID)
  @ApiOperation({ summary: 'Delete label' })
  async delete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.labelsService.delete(id, user.id);
    return { message: MSG.SUCCESS.LABEL_DELETED };
  }
}
