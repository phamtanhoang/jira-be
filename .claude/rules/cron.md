# Cron Jobs

The app uses `@nestjs/schedule` with `ScheduleModule.forRoot()` in `AppModule`. Every cron-decorated method runs in-process on the BE container.

## Current crons

| Decorator | Class.method | Purpose |
|---|---|---|
| `@Cron(EVERY_30_MINUTES)` | `AttachmentsLargeService.sweepExpiredSessions` | Cleanup PENDING/FAILED upload sessions past TTL + their temp chunks |
| `@Cron(EVERY_HOUR)` | `LoggingConfigService.scheduledRefresh` | Refresh in-memory snapshot from DB |
| `@Cron(EVERY_HOUR, { name: 'recurring-issues' })` | `RecurringIssuesService.runDue` | Materialize due recurring-issue templates into real issues |
| `@Cron(EVERY_DAY_AT_3AM)` | `LogsCleanupService.cleanup` | Delete `RequestLog` rows older than `LOG_RETENTION_EXPIRY` |
| `@Cron(EVERY_DAY_AT_3AM, { name: 'gdpr-hard-delete' })` | `GdprService.runHardDelete` | Permanently delete users whose deletion request is older than 30 days |
| `@Cron(EVERY_DAY_AT_8AM, { name: 'notification-digest' })` | `NotificationsDigestService.send` | Send daily digest email to subscribed users |

## Cost discipline

Each cron tick wakes the DB. On Neon free-tier compute that prevents scale-to-zero and burns CU-hrs continuously.

Rule of thumb:
- **Use `EVERY_5_MINUTES` only when latency is the constraint** (e.g. user-visible orphan cleanup). Default to `EVERY_30_MINUTES` or `EVERY_HOUR`.
- **Use `EVERY_DAY_AT_*` for housekeeping** (retention, digests). 3AM is the global "off-peak" slot.
- **Stagger crons** — don't put two `EVERY_HOUR` jobs on `0 * * * *`. Spread to `0 * * * *` + `30 * * * *` so they don't both wake the DB at the same minute.

## Adding a new cron

1. Inject the services you need into your @Injectable class.
2. Add a uniquely-named method:
   ```ts
   @Cron(CronExpression.EVERY_HOUR, { name: 'my-cron-name' })
   async runMyCron() {
     try {
       // ...
     } catch (err) {
       this.logger.warn(`cron failed: ${err.message}`);
       // Don't re-throw — Nest swallows but logs noisily
     }
   }
   ```
3. Cron failures MUST NOT bubble — wrap in try/catch and log. Otherwise NestJS scheduler stops calling that job.

## Multi-instance gotcha

If you ever run multiple BE replicas (you don't right now), every cron fires on every replica → duplicate work. Mitigation options:
- Use a distributed lock (`pg_advisory_lock` in Postgres, or Redis lock).
- Move scheduled work out to a dedicated worker container with `replicas: 1`.
- Use a "leader" pattern via heartbeat row in DB.

Skip until you actually run replicas.

## Things easy to get wrong

- ❌ Long-running cron blocking the event loop — make sure DB queries are paginated (`take: 100`), don't process unbounded rows.
- ❌ Cron throwing → scheduler stops calling that method silently. Always catch + log.
- ❌ Adding a new `EVERY_5_MINUTES` cron without justification — costs scale-to-zero opportunity.
- ❌ Tight time windows (e.g. `EVERY_MINUTE`) for "real-time" feel — usually wrong, use a separate worker queue.
