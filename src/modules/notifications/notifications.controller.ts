import { Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ENDPOINTS, MSG } from '@/core/constants';
import { CurrentUser } from '@/core/decorators';
import { AuthUser } from '@/core/types';
import { NotificationsService } from './notifications.service';

const E = ENDPOINTS.NOTIFICATIONS;

@ApiTags('Notifications')
@Controller(E.BASE)
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  @Get()
  // The bell badge polls this endpoint frequently — service-level filtering
  // by userId is the strong gate; IP throttling here would just punish
  // multi-tab users.
  @SkipThrottle()
  @ApiOperation({
    summary: 'List notifications (page-based, optional unread filter)',
  })
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('unread') unread?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.notificationsService.findAll(user.id, {
      unread: unread === 'true' || unread === '1',
      page: page ? parseInt(page) : undefined,
      pageSize: pageSize ? parseInt(pageSize) : undefined,
    });
  }

  @Get(E.UNREAD_COUNT)
  @SkipThrottle()
  @ApiOperation({ summary: 'Unread notification count for the bell badge' })
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.notificationsService.unreadCount(user.id);
  }

  @Post(E.READ)
  @ApiOperation({ summary: 'Mark a single notification as read' })
  async markRead(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const notification = await this.notificationsService.markRead(id, user.id);
    return { message: MSG.SUCCESS.NOTIFICATION_READ, notification };
  }

  @Post(E.READ_ALL)
  @ApiOperation({ summary: 'Mark all unread notifications as read' })
  async markAllRead(@CurrentUser() user: AuthUser) {
    const result = await this.notificationsService.markAllRead(user.id);
    return { message: MSG.SUCCESS.NOTIFICATIONS_READ_ALL, ...result };
  }

  @Delete(E.BY_ID)
  @ApiOperation({ summary: 'Delete a notification' })
  async delete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.notificationsService.delete(id, user.id);
    return { message: MSG.SUCCESS.NOTIFICATION_DELETED };
  }
}
