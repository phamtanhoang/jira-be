import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { ENDPOINTS } from '@/core/constants';
import { CurrentUser, Roles } from '@/core/decorators';
import type { AuthUser } from '@/core/types';
import { AdminService } from './admin.service';
import {
  BulkInviteDto,
  QueryAdminWorkspacesDto,
  QueryAnalyticsDto,
  QueryMetricsDto,
} from './dto';

const E = ENDPOINTS.ADMIN;

@ApiTags('Admin')
@Roles(Role.ADMIN)
@Controller(E.BASE)
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Get(E.STATS)
  @ApiOperation({ summary: 'System-wide counts for the admin overview' })
  getStats() {
    return this.adminService.getStats();
  }

  @Get(E.HEALTH)
  @ApiOperation({
    summary:
      'Probe DB + supabase + mail + sentry wiring; returns process metrics',
  })
  getHealth() {
    return this.adminService.getHealth();
  }

  @Get(E.ANALYTICS)
  @ApiOperation({
    summary: 'Daily time-series (signups, issues, workspaces, logs-by-level)',
  })
  getAnalytics(@Query() query: QueryAnalyticsDto) {
    return this.adminService.getAnalytics(query.days ?? 14);
  }

  @Get(E.METRICS)
  @ApiOperation({
    summary: 'Top routes by count with p50/p95/p99 latency and error counts',
  })
  getMetrics(@Query() query: QueryMetricsDto) {
    const fallback = query.take ?? 10;
    return this.adminService.getMetrics(query.sinceHours ?? 24, {
      topRoutes: query.topRoutesTake ?? fallback,
      slowest: query.slowestTake ?? fallback,
    });
  }

  @Get(E.USER_ACTIVITY)
  @ApiOperation({
    summary:
      'What end-users actually do in the app. Aggregates RequestLog over the given window, excluding admin traffic.',
  })
  getUserActivity(@Query() query: QueryMetricsDto) {
    return this.adminService.getUserActivity(
      query.sinceHours ?? 168,
      query.take ?? 30,
    );
  }

  @Get(E.WORKSPACES)
  @ApiOperation({ summary: 'List all workspaces across tenants (Admin only)' })
  listWorkspaces(@Query() query: QueryAdminWorkspacesDto) {
    return this.adminService.listAllWorkspaces(query);
  }

  @Get(E.WORKSPACE_BY_ID)
  @ApiOperation({
    summary: 'Workspace detail with counts, storage, recent projects + members',
  })
  getWorkspace(@Param('id') id: string) {
    return this.adminService.getWorkspaceById(id);
  }

  @Delete(E.WORKSPACE_BY_ID)
  @ApiOperation({ summary: 'Admin delete any workspace (cascades)' })
  deleteWorkspace(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.adminService.deleteWorkspace(id, actor.id);
  }

  @Post(E.USERS_BULK_INVITE)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Bulk-invite users by email (admin only)' })
  bulkInvite(@Body() dto: BulkInviteDto, @CurrentUser() actor: AuthUser) {
    return this.adminService.bulkInviteUsers(actor.id, dto.emails, dto.message);
  }
}
