import { Global, Module } from '@nestjs/common';
import { LogsCleanupService } from './logs-cleanup.service';
import { LogsController } from './logs.controller';
import { LogsService } from './logs.service';

@Global()
@Module({
  controllers: [LogsController],
  providers: [LogsService, LogsCleanupService],
  exports: [LogsService],
})
export class LogsModule {}
