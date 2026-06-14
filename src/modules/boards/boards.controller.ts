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
import { BoardsService } from './boards.service';
import { CreateColumnDto, UpdateColumnDto, ReorderColumnsDto } from './dto';

const E = ENDPOINTS.BOARDS;

@ApiTags('Boards')
@Controller(E.BASE)
export class BoardsController {
  constructor(private boardsService: BoardsService) {}

  @Get(E.BY_PROJECT)
  @ApiOperation({ summary: 'Get board by project ID (with columns & issues)' })
  findByProject(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
  ) {
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

  // ⚠ Route order matters. `REORDER_COLUMNS` (literal `…/columns/reorder`)
  // MUST be declared BEFORE `COLUMN_BY_ID` (`…/columns/:columnId`) — Express
  // matches routes in registration order, and `:columnId` swallows the
  // string "reorder". The previous order routed `PATCH …/columns/reorder`
  // into `updateColumn` with `columnId="reorder"`, then `UpdateColumnDto`
  // rejected the body with 400 "property columnIds should not exist"
  // (production bug, June 2026).
  @Patch(E.REORDER_COLUMNS)
  @ApiOperation({ summary: 'Reorder columns' })
  async reorderColumns(
    @Param('boardId') boardId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ReorderColumnsDto,
  ) {
    const columns = await this.boardsService.reorderColumns(
      boardId,
      user.id,
      dto,
    );
    return { message: MSG.SUCCESS.COLUMNS_REORDERED, columns };
  }

  @Patch(E.COLUMN_BY_ID)
  @ApiOperation({ summary: 'Update column' })
  async updateColumn(
    @Param('boardId') boardId: string,
    @Param('columnId') columnId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateColumnDto,
  ) {
    const column = await this.boardsService.updateColumn(
      boardId,
      columnId,
      user.id,
      dto,
    );
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
}
