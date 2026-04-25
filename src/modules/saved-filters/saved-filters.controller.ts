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
import { CreateSavedFilterDto, UpdateSavedFilterDto } from './dto';
import { SavedFiltersService } from './saved-filters.service';

const E = ENDPOINTS.SAVED_FILTERS;

@ApiTags('Saved Filters')
@Controller(E.BASE)
export class SavedFiltersController {
  constructor(private service: SavedFiltersService) {}

  @Get()
  @ApiOperation({ summary: 'List filters visible to me in a project' })
  findAll(
    @Query('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.findAll(projectId, user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a saved filter' })
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateSavedFilterDto,
  ) {
    const filter = await this.service.create(user.id, dto);
    return { message: MSG.SUCCESS.SAVED_FILTER_CREATED, filter };
  }

  @Patch(E.BY_ID)
  @ApiOperation({ summary: 'Update a saved filter (owner only)' })
  async update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateSavedFilterDto,
  ) {
    const filter = await this.service.update(id, user.id, dto);
    return { message: MSG.SUCCESS.SAVED_FILTER_UPDATED, filter };
  }

  @Delete(E.BY_ID)
  @ApiOperation({ summary: 'Delete a saved filter (owner only)' })
  async delete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.service.delete(id, user.id);
    return { message: MSG.SUCCESS.SAVED_FILTER_DELETED };
  }
}
