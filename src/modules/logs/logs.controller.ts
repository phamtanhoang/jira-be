import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Prisma, Role } from '@prisma/client';
import type { Request } from 'express';
import { ENDPOINTS, MSG } from '@/core/constants';
import { CurrentUser, Roles } from '@/core/decorators';
import { AuthUser } from '@/core/types';
import { CreateClientLogDto, QueryLogsDto } from './dto';
import { LogsService } from './logs.service';

const E = ENDPOINTS.LOGS;

@ApiTags('Logs')
@Controller(E.BASE)
export class LogsController {
  constructor(private logsService: LogsService) {}

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'List request logs with filters (Admin only)' })
  findAll(@Query() query: QueryLogsDto) {
    return this.logsService.findAll(query);
  }

  @Get(E.BY_ID)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Get a single log by id (Admin only)' })
  findOne(@Param('id') id: string) {
    return this.logsService.findOne(id);
  }

  @Post(E.CLIENT)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @ApiOperation({ summary: 'Ingest a log entry from the frontend client' })
  createClientLog(
    @Body() dto: CreateClientLogDto,
    @CurrentUser() user: AuthUser | null,
    @Req() req: Request,
  ) {
    this.logsService.enqueue({
      level: dto.level,
      source: 'frontend',
      method: dto.method ?? 'CLIENT',
      url: dto.url,
      statusCode: dto.statusCode,
      userId: user?.id,
      userEmail: user?.email,
      ip: req.ip,
      userAgent: dto.userAgent ?? req.headers['user-agent'],
      requestBody: dto.requestBody as Prisma.InputJsonValue,
      responseBody: dto.responseBody as Prisma.InputJsonValue,
      errorMessage: dto.errorMessage,
      errorStack: dto.errorStack,
      breadcrumbs: dto.breadcrumbs as unknown as Prisma.InputJsonValue,
      sentryEventId: dto.sentryEventId,
    });
    return { message: MSG.SUCCESS.LOG_ACCEPTED };
  }
}
