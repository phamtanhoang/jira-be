import { Global, Module } from '@nestjs/common';
import { SentryService } from '@/core/services/sentry.service';
import { MailLogController } from './mail-log.controller';
import { MailLogService } from './mail-log.service';
import { MailService } from './mail.service';

/**
 * @Global so AdminController + AuthService can both inject MailService /
 * MailLogService without each module having to remember to import this.
 */
@Global()
@Module({
  controllers: [MailLogController],
  providers: [MailService, MailLogService, SentryService],
  exports: [MailService, MailLogService],
})
export class MailModule {}
