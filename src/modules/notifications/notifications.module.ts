import { Global, Module } from '@nestjs/common';
import { DigestService } from './digest.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

// @Global so any service (issues, comments, sprints…) can inject
// NotificationsService without re-importing this module — same pattern as
// AdminAuditModule. Notification emission is fire-and-forget and must not
// burden the caller with module-graph plumbing.
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, DigestService],
  exports: [NotificationsService, DigestService],
})
export class NotificationsModule {}
