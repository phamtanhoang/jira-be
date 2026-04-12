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
import { CreateColumnDto, UpdateColumnDto, ReorderColumnsDto } from './dto';
import { BoardsService } from './boards.service';

const E = ENDPOINTS.BOARDS;

@ApiTags('Boards')
@Controller(E.BASE)
export class BoardsController {
  constructor(private boardsService: BoardsService) {}

  @Get(E.BY_PROJECT)
  @ApiOperation({ summary: 'Get board by project ID (with columns & issues)' })
  findByProject(@Param('projectId') projectId: string, @CurrentUser() user: AuthUser) {
    return this.boardsService.findByProject(projectId, user.id);
  }

  @Post(E.COLUMNS)
  @ApiOperation({ summary: 'Add column to board' })
  async addColumn(
    @Param('boardId') boardId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateColumnDto,
  ) {
    const column = await this.boardsService.addColumn(boardId, user.id, dto);
    return { message: MSG.SUCCESS.COLUMN_CREATED, column };
  }

  @Patch(E.COLUMN_BY_ID)
  @ApiOperation({ summary: 'Update column' })
  async updateColumn(
    @Param('boardId') boardId: string,
    @Param('columnId') columnId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateColumnDto,
  ) {
    const column = await this.boardsService.updateColumn(boardId, columnId, user.id, dto);
    return { message: MSG.SUCCESS.COLUMN_UPDATED, column };
  }

  @Delete(E.COLUMN_BY_ID)
  @ApiOperation({ summary: 'Delete column' })
  async deleteColumn(
    @Param('boardId') boardId: string,
    @Param('columnId') columnId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.boardsService.deleteColumn(boardId, columnId, user.id);
    return { message: MSG.SUCCESS.COLUMN_DELETED };
  }

  @Patch(E.REORDER_COLUMNS)
  @ApiOperation({ summary: 'Reorder columns' })
  async reorderColumns(
    @Param('boardId') boardId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ReorderColumnsDto,
  ) {
    const columns = await this.boardsService.reorderColumns(boardId, user.id, dto);
    return { message: MSG.SUCCESS.COLUMNS_REORDERED, columns };
  }
}
