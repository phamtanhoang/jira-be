import { Global, Module } from '@nestjs/common';
import { LoggingConfigService } from './logging-config.service';

/**
 * Global so any service (logs, audit, mail-log, webhooks) can inject
 * `LoggingConfigService` without importing the module.
 */
@Global()
@Module({
  providers: [LoggingConfigService],
  exports: [LoggingConfigService],
})
export class LoggingConfigModule {}
