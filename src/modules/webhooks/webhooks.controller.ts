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
import { Role } from '@prisma/client';
import { ENDPOINTS } from '@/core/constants';
import { CurrentUser, Roles } from '@/core/decorators';
import type { AuthUser } from '@/core/types';
import { CreateWebhookDto, UpdateWebhookDto } from './dto';
import { WebhooksService } from './webhooks.service';

const W = ENDPOINTS.WORKSPACES;
const A = ENDPOINTS.ADMIN;

@ApiTags('Webhooks')
@Controller(W.BASE)
export class WebhooksController {
  constructor(private service: WebhooksService) {}

  @Get(`:id/${W.WEBHOOKS}`)
  @ApiOperation({ summary: 'List webhooks for a workspace' })
  list(@Param('id') workspaceId: string, @CurrentUser() user: AuthUser) {
    return this.service.list(workspaceId, user.id);
  }

  @Post(`:id/${W.WEBHOOKS}`)
  @ApiOperation({ summary: 'Create a webhook (admin/owner)' })
  create(
    @Param('id') workspaceId: string,
    @Body() dto: CreateWebhookDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.create(workspaceId, user.id, dto);
  }

  @Patch(`:id/${W.WEBHOOKS}/:webhookId`)
  @ApiOperation({ summary: 'Update webhook' })
  update(
    @Param('id') workspaceId: string,
    @Param('webhookId') webhookId: string,
    @Body() dto: UpdateWebhookDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(workspaceId, webhookId, user.id, dto);
  }

  @Delete(`:id/${W.WEBHOOKS}/:webhookId`)
  @ApiOperation({ summary: 'Delete webhook' })
  remove(
    @Param('id') workspaceId: string,
    @Param('webhookId') webhookId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.remove(workspaceId, webhookId, user.id);
  }

  @Post(`:id/${W.WEBHOOKS}/:webhookId/test`)
  @ApiOperation({ summary: 'Send a synthetic test event' })
  test(
    @Param('id') workspaceId: string,
    @Param('webhookId') webhookId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.testSend(workspaceId, webhookId, user.id);
  }
}

@ApiTags('Admin/Webhooks')
@Roles(Role.ADMIN)
@Controller(A.BASE)
export class WebhookDeliveriesController {
  constructor(private service: WebhooksService) {}

  @Get(A.WEBHOOK_DELIVERIES)
  @ApiOperation({ summary: 'Cross-workspace webhook delivery log' })
  listDeliveries(
    @Query('webhookId') webhookId?: string,
    @Query('status') status?: 'PENDING' | 'SUCCESS' | 'FAILED',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.listDeliveries({
      webhookId,
      status,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Post(A.WEBHOOK_DELIVERY_RETRY)
  @ApiOperation({
    summary: 'Retry a failed delivery (creates a new attempt row)',
  })
  retry(@Param('id') id: string) {
    return this.service.retryDelivery(id);
  }
}
