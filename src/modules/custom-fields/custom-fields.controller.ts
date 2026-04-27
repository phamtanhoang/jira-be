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
import { CurrentUser } from '@/core/decorators';
import type { AuthUser } from '@/core/types';
import { CustomFieldsService } from './custom-fields.service';
import { CreateCustomFieldDto, UpdateCustomFieldDto } from './dto';

@ApiTags('CustomFields')
@Controller('custom-fields')
export class CustomFieldsController {
  constructor(private service: CustomFieldsService) {}

  @Get()
  @ApiOperation({ summary: 'List custom fields for a project' })
  list(@Query('projectId') projectId: string, @CurrentUser() user: AuthUser) {
    return this.service.listForProject(projectId, user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a custom field (admin/lead)' })
  create(@Body() dto: CreateCustomFieldDto, @CurrentUser() user: AuthUser) {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update name/options/required/position' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomFieldDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a custom field (cascades values)' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.delete(id, user.id);
  }
}
