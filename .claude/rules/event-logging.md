# Event-driven Logging

Replaces the legacy "log every request" model. The `RequestLog` table now holds **meaningful events** (auth flow milestones, security, errors, slow requests) — NOT one row per HTTP request.

## Source of truth

| Layer | Where |
|---|---|
| Event vocabulary | `src/modules/logs/event-logger.service.ts` — the `EVENTS` const + `EventName` type |
| Logger API | `EventLoggerService.log(event, params)` — fire-and-forget |
| Buffered writer | `LogsService.enqueue` (internal) — batches via `createMany` every 2s / 50 entries |
| Admin kill switch | `LoggingConfigService.isEnabled(channel)` — synced from `Setting` row `app.logging_config` |

## What to log (in order of importance)

| Domain | Events | Notes |
|---|---|---|
| **Security / auth** | `auth.login.success/failed`, `auth.logout`, `auth.signup`, `auth.password.*`, `auth.email.verified`, `authz.denied` | Always 100% logged — security audit trail |
| **Operational** | `ratelimit.hit`, `quota.exceeded`, `perf.slow_request` | Signal for capacity planning |
| **Errors** | `error.5xx`, `error.uncaught` | Every occurrence — kept alongside Sentry |

## What NOT to log

- ❌ Successful GETs (read traffic) — access log noise lives in stdout / `docker logs`
- ❌ 401 on `/auth/me` `/auth/refresh` — normal protocol probes
- ❌ 404, 400 validation — not interesting, FE consumes
- ❌ Polling endpoints (notifications/unread-count, health) — would flood the table

## Adding a new event

1. Add the constant to `EVENTS` in `event-logger.service.ts`:
   ```ts
   export const EVENTS = {
     // ...existing...
     PROJECT_CREATED: 'project.created',
   } as const;
   ```
2. Update the FE mirror in `jira-fe/src/features/logs/types.ts` → `EVENT_NAMES` so the filter dropdown picks it up.
3. Emit at the right site:
   ```ts
   this.events.log(EVENTS.PROJECT_CREATED, {
     userId: user.id,
     userEmail: user.email,
     metadata: { projectId, workspaceId, key },
   });
   ```
4. Pick the right `level` (defaults via `defaultLevelFor` — INFO for normal, WARN for security/perf, ERROR for failures).
5. Keep `metadata` small + intentional. Avoid dumping full request bodies.

## Two emit sites that are NOT services

- `RequestLoggerInterceptor` (`src/core/interceptors/request-logger.interceptor.ts`) — emits `perf.slow_request` when latency > `SLOW_REQUEST_THRESHOLD_MS`.
- `AllExceptionsFilter` (`src/core/filters/http-exception.filter.ts`) — emits one of `error.5xx`, `authz.denied`, `ratelimit.hit` based on HTTP status. Other statuses are intentionally dropped (stdout logger still captures them).

## Things easy to get wrong

- ❌ Calling `EventLoggerService.log` with `await` — it's fire-and-forget by design (immediate sync push to buffer).
- ❌ Adding an event name without updating the FE `EVENT_NAMES` mirror — FE filter dropdown silently misses it.
- ❌ Putting sensitive data in `metadata` (password, OTP, full token) — `metadata` is NOT sanitized currently. Keep it to ids + counts + categorical values.
- ❌ Re-introducing per-request access logging — the table is intentionally low-volume. If you need to debug a noisy endpoint, use `docker logs jira-be` and grep, not `RequestLog`.

## Querying events

Admin UI: `/admin/logs` → tab Requests → filter "Event" dropdown picks from the typed list. Filter combinations work (event + level + user + date range).

Direct SQL (Prisma Studio or psql):
```sql
SELECT event, COUNT(*) FROM "RequestLog"
WHERE "createdAt" > NOW() - INTERVAL '7 days'
GROUP BY event ORDER BY 2 DESC;
```
