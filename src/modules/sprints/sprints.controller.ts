import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ENDPOINTS, MSG } from '@/core/constants';
import { CurrentUser } from '@/core/decorators';
import { AuthUser } from '@/core/types';
import { CreateSprintDto, UpdateSprintDto } from './dto';
import { SprintsService } from './sprints.service';

const E = ENDPOINTS.SPRINTS;

@ApiTags('Sprints')
@Controller(E.BASE)
export class SprintsController {
  constructor(private sprintsService: SprintsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new sprint' })
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateSprintDto) {
    const sprint = await this.sprintsService.create(user.id, dto);
    return { message: MSG.SUCCESS.SPRINT_CREATED, sprint };
  }

  @Get(E.BY_ID)
  @ApiOperation({ summary: 'Get sprint by ID with issues' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.sprintsService.findById(id, user.id);
  }

  @Patch(E.BY_ID)
  @ApiOperation({ summary: 'Update sprint' })
  async update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateSprintDto,
  ) {
    const sprint = await this.sprintsService.update(id, user.id, dto);
    return { message: MSG.SUCCESS.SPRINT_UPDATED, sprint };
  }

  @Post(E.START)
  @ApiOperation({ summary: 'Start sprint' })
  async start(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const sprint = await this.sprintsService.start(id, user.id);
    return { message: MSG.SUCCESS.SPRINT_STARTED, sprint };
  }

  @Post(E.COMPLETE)
  @ApiOperation({
    summary: 'Complete sprint (moves incomplete issues to backlog)',
  })
  async complete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const sprint = await this.sprintsService.complete(id, user.id);
    return { message: MSG.SUCCESS.SPRINT_COMPLETED, sprint };
  }

  @Get(E.BURNDOWN)
  @ApiOperation({ summary: 'Get sprint burndown chart data' })
  getBurndown(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.sprintsService.getBurndown(id, user.id);
  }

  @Get(E.VELOCITY)
  @ApiOperation({
    summary:
      'Per-sprint velocity (committed vs completed) for the last 12 closed sprints + 3-sprint predicted capacity',
  })
  getVelocity(
    @Param('boardId') boardId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sprintsService.getVelocity(boardId, user.id);
  }

  @Get(E.CFD)
  @ApiOperation({
    summary: 'Cumulative flow diagram — daily count by status category',
  })
  getCfd(
    @Param('boardId') boardId: string,
    @CurrentUser() user: AuthUser,
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
  ) {
    // Clamp 7..90 — short windows are noisy, long ones blow up the
    // cross-join in the SQL.
    const clamped = Math.max(7, Math.min(90, days));
    return this.sprintsService.getCumulativeFlow(boardId, user.id, clamped);
  }

  @Delete(E.BY_ID)
  @ApiOperation({ summary: 'Delete sprint' })
  async delete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.sprintsService.delete(id, user.id);
    return { message: MSG.SUCCESS.SPRINT_DELETED };
  }
}
