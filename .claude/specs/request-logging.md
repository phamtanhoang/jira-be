# API: Request/Error Logging + Sentry

## Status: done

## Problem
- `AllExceptionsFilter` (src/core/filters/http-exception.filter.ts) caught all exceptions but only returned the response — **no logging**. Errors vanished.
- No request log existed — impossible to reproduce "user X hit bug Y at time Z" without manual logs from dev.
- `Activity` table is issue-domain only (CREATED, UPDATED, …) — could not repurpose for HTTP error tracking.

## Fix
Added a dedicated `RequestLog` table + `LogsModule` that captures every API request (success + error) with sanitized payloads. Errors are mirrored to Sentry for dashboard/search/alerts. FE posts client-side errors to the same pipeline via `POST /logs/client`.

## Architecture
```
RequestLoggerInterceptor ──┐
                            ├─→ LogsService.enqueue()  ──→ (buffer 2s) createMany
AllExceptionsFilter ────────┤                          └─→ Sentry.captureException (ERROR only)
POST /logs/client (from FE) ┘

@Cron(EVERY_DAY_AT_3AM) → delete rows > LOG_RETENTION_EXPIRY
```
Fire-and-forget: logging failures NEVER affect HTTP response.

## Database — `RequestLog` (single table)
File: [prisma/request-log.prisma](../../prisma/request-log.prisma). Migration `20260423053951_add_request_log`.

Fields: `id`, `level` (INFO/WARN/ERROR), `source` (backend/frontend), `method`, `url`, `route`, `statusCode`, `durationMs`, `userId`, `userEmail`, `ip`, `userAgent`, `requestBody` (Json, sanitized), `requestQuery` (Json), `responseBody` (Json), `errorMessage`, `errorStack` (Text), `breadcrumbs` (Json), `sentryEventId`, `createdAt`.

Indexes: `createdAt`, `(userId, createdAt)`, `(level, createdAt)`, `statusCode`.

## Endpoints

### `GET /logs` — List logs (ADMIN only)
Query params (all optional):
- `level` — INFO | WARN | ERROR
- `method` — GET | POST | …
- `statusCode` — exact (number)
- `userEmail` — substring match (case-insensitive)
- `search` — free-text on `url`
- `dateFrom`, `dateTo` — ISO-8601
- `cursor`, `take` — cursor pagination (default 50, max 200)

Response:
```json
{
  "data": [ { "id": "...", "level": "ERROR", "method": "POST", "url": "/issues", "statusCode": 500, "userEmail": "a@b.co", "errorMessage": "...", "durationMs": 142, "createdAt": "..." } ],
  "nextCursor": "uuid-or-null",
  "hasMore": true
}
```

### `GET /logs/:id` — Detail (ADMIN only)
Returns full row including `requestBody`, `responseBody`, `errorStack`, `breadcrumbs`, `sentryEventId`.

### `POST /logs/client` — Ingest from FE
Auth required (JwtAuthGuard global). `@Throttle({ ttl: 60000, limit: 20 })`.

Body (`CreateClientLogDto`): `{ level, url, method?, statusCode?, errorMessage?, errorStack?, breadcrumbs?, requestBody?, responseBody?, userAgent?, sentryEventId? }`.

Service sets `source: "frontend"`, pulls `userId/userEmail` from `@CurrentUser`, IP from request.

## Sensitive field sanitization
[src/core/utils/sanitize.util.ts](../../src/core/utils/sanitize.util.ts). Recursive, case-insensitive key match on:
```
password, newPassword, oldPassword, currentPassword, confirmPassword,
token, accessToken, refreshToken, idToken, apiKey,
otp, secret, clientSecret, authorization, cookie, setCookie,
creditCard, cvv, ssn
```
→ value replaced with `"***"`.

**Extra safety:**
- `sanitizeHeaders()` strips `Authorization`, `Cookie`, `Set-Cookie` before log.
- `REDACTED_BODY_ROUTES` (`/auth/login`, `/auth/register`, `/auth/reset-password`, `/auth/verify-email`, `/auth/forgot-password`) → **drop `requestBody` entirely**.
- `SKIP_RESPONSE_BODY_ROUTES` (`/attachments`, `/files`) → skip `responseBody`.
- Body > 32KB → replaced with `{ _truncated: true, size: N }`.
- Depth cap = 10, WeakSet to avoid cycles.

## Performance (hot path)
[LogsService](../../src/modules/logs/logs.service.ts):
- In-memory `buffer: EnqueueLogInput[]`.
- `enqueue()` sync (just `push`); drops oldest if buffer > 500 entries (DB-down safety).
- `onModuleInit` starts `setInterval(flush, 2000)`. `flush` also fires when `buffer.length >= 50`.
- `flush` calls `prisma.requestLog.createMany` inside try/catch. Errors logged via `Logger.error`, never thrown.
- Request handlers never wait on logging.

## Retention
[LogsCleanupService](../../src/modules/logs/logs-cleanup.service.ts) using `@nestjs/schedule`:
```ts
@Cron(CronExpression.EVERY_DAY_AT_3AM)
async cleanup() {
  const cutoff = new Date(Date.now() - ENV.LOG_RETENTION_EXPIRY * 1000);
  await this.prisma.requestLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
}
```
Value is seconds (same unit as `TOKEN_VERIFY_EXPIRY`, `JWT_*_EXPIRATION`). 30 days = 2592000.

## Sentry Integration
Package: `@sentry/nestjs`. Init in [src/main.ts](../../src/main.ts) **before** `NestFactory.create`:
```ts
if (ENV.SENTRY_DSN) {
  Sentry.init({
    dsn: ENV.SENTRY_DSN,
    environment: ENV.SENTRY_ENV,
    tracesSampleRate: 0.1,
  });
}
```
[SentryService](../../src/core/services/sentry.service.ts) wraps it with graceful no-op when DSN missing. Filter calls `sentryService.captureException(exception, { user, extra: { url, method, statusCode } })` and stores the returned event ID in `RequestLog.sentryEventId`.

**Only `status >= 500` goes to Sentry.** 4xx validation failures stay in DB only (quota-friendly).

## Files Modified / Added

**New:**
- [prisma/request-log.prisma](../../prisma/request-log.prisma) + migration `20260423053951_add_request_log`
- [src/core/utils/sanitize.util.ts](../../src/core/utils/sanitize.util.ts) + [test/unit/core/utils/sanitize.util.spec.ts](../../test/unit/core/utils/sanitize.util.spec.ts) (13 tests)
- [src/core/interceptors/request-logger.interceptor.ts](../../src/core/interceptors/request-logger.interceptor.ts)
- [src/core/services/sentry.service.ts](../../src/core/services/sentry.service.ts)
- [src/modules/logs/logs.module.ts](../../src/modules/logs/logs.module.ts) (`@Global`)
- [src/modules/logs/logs.service.ts](../../src/modules/logs/logs.service.ts)
- [src/modules/logs/logs.controller.ts](../../src/modules/logs/logs.controller.ts)
- [src/modules/logs/logs-cleanup.service.ts](../../src/modules/logs/logs-cleanup.service.ts)
- [src/modules/logs/dto/](../../src/modules/logs/dto/) — `query-logs.dto.ts`, `create-client-log.dto.ts`, `index.ts`

**Modified:**
- [src/core/filters/http-exception.filter.ts](../../src/core/filters/http-exception.filter.ts) — inject `LogsService` + `SentryService`, log sanitized error + capture Sentry (5xx only). Decorated with `@Injectable()`.
- [src/main.ts](../../src/main.ts) — Sentry init before bootstrap; filter now registered via `APP_FILTER` (removed manual `useGlobalFilters`).
- [src/app.module.ts](../../src/app.module.ts) — `LogsModule`, `ScheduleModule.forRoot()`, `APP_INTERCEPTOR` for `RequestLoggerInterceptor`, `APP_FILTER` for `AllExceptionsFilter`, added `SentryService` provider.
- [src/core/constants/env.constant.ts](../../src/core/constants/env.constant.ts) — `SENTRY_DSN`, `SENTRY_ENV`, `LOG_RETENTION_EXPIRY` (seconds; default 2592000 = 30 days).
- [src/core/constants/endpoint.constant.ts](../../src/core/constants/endpoint.constant.ts) — `LOGS: { BASE, BY_ID, CLIENT }`.
- [src/core/constants/message.constant.ts](../../src/core/constants/message.constant.ts) — `SUCCESS.LOG_ACCEPTED`, `ERROR.LOG_NOT_FOUND`.
- [src/core/utils/index.ts](../../src/core/utils/index.ts) — re-export sanitize util.
- [src/core/interceptors/index.ts](../../src/core/interceptors/index.ts) — re-export RequestLoggerInterceptor.
- Pre-existing lint fixes to make CI green: [boards.service.ts](../../src/modules/boards/boards.service.ts), [issues.service.ts](../../src/modules/issues/issues.service.ts).

## Dependencies Added
- `@sentry/nestjs` ^10.49.0
- `@nestjs/schedule` ^6.1.3

## Risks & Mitigations
| Risk | Mitigation |
|---|---|
| DB write per request slows API | Buffered createMany every 2s / 50 entries; max 500 in-memory |
| Logging throw breaks response | All logging in try/catch, failures swallowed |
| JWT/cookie leaked in logs | Auth headers stripped; auth-route bodies dropped |
| Log bloat | 30-day retention cron + indexed queries |
| Sentry 5k/mo free tier | Only status>=500 sent; `tracesSampleRate: 0.1` |

## Verification
1. ✅ Hit any endpoint → `SELECT * FROM "RequestLog" ORDER BY "createdAt" DESC LIMIT 10` shows a row.
2. ✅ POST `/auth/register` with password → row's `requestBody` is `null` (route redacted).
3. ✅ POST `/auth/login` with wrong credentials → row has `level=WARN`, `statusCode=401`, `requestBody=null`.
4. ⏳ (needs DSN) Throw in any handler → Sentry dashboard receives event, `sentryEventId` saved in DB row.
5. ✅ Stop Postgres → trigger error → app still responds 500 (no cascade). Bring DB back → next flush succeeds.
6. ✅ Insert row with `createdAt = NOW() - 31 days` → run cleanup manually → row gone.

### Local checks
- `npm run lint:check` → 0 errors
- `npm run type-check` → passes
- `npm run test:run` → 38/38 (13 new sanitize tests)
