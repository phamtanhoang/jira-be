# Logging & PII

## Sanitization
- ALWAYS add new sensitive DTO field names to `SENSITIVE_KEYS` in `src/core/utils/sanitize.util.ts` — matched case-insensitively, dashes/underscores normalized
- ALWAYS use `sanitize()` before persisting any payload that may contain user input (request body, response body, breadcrumbs)
- ALWAYS strip `Authorization`, `Cookie`, `Set-Cookie` via `sanitizeHeaders()` before logging headers
- PREFER dropping request body entirely for auth-like routes — add to `REDACTED_BODY_ROUTES`
- PREFER skipping response body for binary/large routes — add to `SKIP_RESPONSE_BODY_ROUTES`

## Log injection
- NEVER call `LogsService.enqueue` in a way that can throw — wrap in try/catch and swallow. Logging MUST NOT affect the HTTP response
- NEVER `await` logging from a request handler — `enqueue` is fire-and-forget by design (sync push to buffer)
- NEVER bypass the buffer and write directly to `prisma.requestLog` from a hot path — use `enqueue` so writes batch

## Sentry
- ONLY send `status >= 500` to Sentry — 4xx validation failures stay in DB only to preserve free-tier quota
- NEVER call `Sentry.captureException` outside `SentryService` — the wrapper no-ops gracefully when `SENTRY_DSN` is missing OR when `NODE_ENV !== "production"` (local dev); direct calls crash on unconfigured dev machines
- ALWAYS store the returned `sentryEventId` on the DB row so admins can cross-link Sentry ↔ local log

## Endpoints
- ALWAYS decorate log-browsing routes with `@Roles(Role.ADMIN)` — these contain cross-tenant data
- ALWAYS rate-limit `POST /logs/client` (currently `@Throttle({ ttl: 60000, limit: 20 })`) — public-facing ingest endpoint

## Retention
- ALWAYS run `LogsCleanupService` (enabled via `ScheduleModule.forRoot()` in `AppModule`). If disabled, the `RequestLog` table grows unbounded
- PREFER adjusting `ENV.LOG_RETENTION_EXPIRY` over changing the cron expression
