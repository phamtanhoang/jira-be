import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ENV } from '@/core/constants';
import { LogsService } from './logs.service';

@Injectable()
export class LogsCleanupService {
  private readonly logger = new Logger(LogsCleanupService.name);

  constructor(private logsService: LogsService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanup() {
    const cutoff = new Date(Date.now() - ENV.LOG_RETENTION_EXPIRY * 1000);
    try {
      const count = await this.logsService.deleteOlderThan(cutoff);
      this.logger.log(
        `Deleted ${count} request logs older than ${ENV.LOG_RETENTION_EXPIRY} seconds`,
      );
    } catch (err) {
      this.logger.error('Log cleanup failed', err as Error);
    }
  }
}
