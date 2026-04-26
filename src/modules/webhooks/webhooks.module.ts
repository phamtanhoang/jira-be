import { Global, Module } from '@nestjs/common';
import { WorkspacesModule } from '@/modules/workspaces/workspaces.module';
import {
  WebhookDeliveriesController,
  WebhooksController,
} from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

// @Global so triggers (issues, comments) can inject WebhooksService without
// re-importing the module — same pattern as NotificationsModule.
@Global()
@Module({
  imports: [WorkspacesModule],
  controllers: [WebhooksController, WebhookDeliveriesController],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
