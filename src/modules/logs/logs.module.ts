import { Global, Module } from '@nestjs/common';
import { EventLoggerService } from './event-logger.service';
import { LogsCleanupService } from './logs-cleanup.service';
import { LogsController } from './logs.controller';
import { LogsService } from './logs.service';

@Global()
@Module({
  controllers: [LogsController],
  providers: [LogsService, EventLoggerService, LogsCleanupService],
  exports: [LogsService, EventLoggerService],
})
export class LogsModule {}
