import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SETTING_KEYS } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';

/**
 * Per-channel logging on/off switches. The hot path (RequestLog
 * `enqueue`) reads these synchronously, so we keep an in-memory
 * snapshot refreshed periodically + on-demand-after-settings-mutation.
 *
 * Why not just `cache-manager`? Because the consumers want a sync read
 * (interceptors / filters shouldn't `await` a Prisma round-trip just to
 * decide whether to skip a log row). The snapshot pattern gives O(1)
 * sync reads with eventual consistency.
 */
export type LoggingConfig = {
  /** Master kill switch — `false` disables EVERYTHING below. */
  enabled: boolean;
  /** Every HTTP request → `RequestLog`. Highest volume. */
  requestLog: boolean;
  /** Admin destructive actions → `AdminAuditLog`. */
  adminAudit: boolean;
  /** Email send/fail → `MailLog`. */
  mailLog: boolean;
  /** Outbound webhook delivery attempts → `WebhookDelivery`. */
  webhookDelivery: boolean;
};

export const DEFAULT_LOGGING_CONFIG: LoggingConfig = {
  enabled: true,
  requestLog: true,
  adminAudit: true,
  mailLog: true,
  webhookDelivery: true,
};

@Injectable()
export class LoggingConfigService implements OnModuleInit {
  private readonly logger = new Logger(LoggingConfigService.name);
  private snapshot: LoggingConfig = DEFAULT_LOGGING_CONFIG;

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    await this.refresh();
  }

  /**
   * Pull the latest config from DB into the snapshot. Called:
   *   - At module init so the very first request sees the right state.
   *   - Every 5 minutes by the cron below (catches mutations from
   *     another BE replica if we ever scale horizontally).
   *   - On-demand by `SettingsService.setByKey` immediately after the
   *     toggle is saved — that path is the snappy one for admins
   *     watching the effect take hold.
   */
  async refresh(): Promise<void> {
    try {
      const setting = await this.prisma.setting.findUnique({
        where: { key: SETTING_KEYS.APP_LOGGING_CONFIG },
      });
      const value = (setting?.value ?? {}) as Partial<LoggingConfig>;
      this.snapshot = {
        enabled: value.enabled ?? DEFAULT_LOGGING_CONFIG.enabled,
        requestLog: value.requestLog ?? DEFAULT_LOGGING_CONFIG.requestLog,
        adminAudit: value.adminAudit ?? DEFAULT_LOGGING_CONFIG.adminAudit,
        mailLog: value.mailLog ?? DEFAULT_LOGGING_CONFIG.mailLog,
        webhookDelivery:
          value.webhookDelivery ?? DEFAULT_LOGGING_CONFIG.webhookDelivery,
      };
    } catch (err) {
      // If we can't read the setting (DB down, table missing, etc.)
      // fall through to defaults — the alternative is a system-wide
      // throw on every request, which is much worse.
      this.logger.warn(
        `Failed to refresh logging config snapshot; using defaults: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      this.snapshot = DEFAULT_LOGGING_CONFIG;
    }
  }

  // Periodic refresh catches setting changes that bypass setByKey() — e.g.
  // someone edits the row directly via Prisma Studio. Toggles are admin-
  // rare-write, so a 1-hour cadence is plenty + saves cron-driven Neon
  // compute. The admin UI still triggers an immediate refresh on save.
  @Cron(CronExpression.EVERY_HOUR)
  async scheduledRefresh() {
    await this.refresh();
  }

  /** Sync read — safe to call from interceptors / fire-and-forget paths. */
  isEnabled(channel: Exclude<keyof LoggingConfig, 'enabled'>): boolean {
    return this.snapshot.enabled && this.snapshot[channel] === true;
  }

  /** Read-only snapshot accessor for the admin UI / settings GET. */
  getSnapshot(): LoggingConfig {
    return { ...this.snapshot };
  }
}
