# Throttle

## Global default
- `ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }])` in `app.module.ts` — 60 req/minute (1 req/s average).
- Low enough to catch bots, high enough that normal authenticated flows (bulk edits, drag-drops, quick-edits) don't trip it.
- **DO NOT lower the global limit** — if an endpoint needs to be stricter, apply `@Throttle()` per-route instead.

## Per-route overrides — required
| Endpoint | Decorator | Rationale |
|---|---|---|
| `POST /auth/register` | `@Throttle({ default: { ttl: 60000, limit: 5 } })` | Signup abuse |
| `POST /auth/login` | `5/60s` | Credential stuffing |
| `POST /auth/forgot-password` | `3/60s` | Email bomb |
| `POST /auth/verify-email` | `5/300000` (5 per 5 min) | OTP brute-force; match OTP expiry window |
| `POST /auth/refresh` | `10/60s` | Allow small burst across tabs |
| `POST /auth/logout` | `5/60s` | Prevent session-cycling |
| `POST /auth/change-password` | `5/60s` | Password-guess abuse |
| `POST /auth/avatar` | `5/60s` | File upload |
| `POST /issues/:id/attachments` | `10/60s` | File upload |
| `POST /settings/app-info/logo` | `3/60s` | Admin-only upload |
| `POST /logs/client` | `20/60s` | FE ingest — high volume expected, still capped |

## `@SkipThrottle()` — authenticated read-heavy endpoints
Apply when: the route is guarded by JwtAuthGuard AND the service layer calls `workspacesService.assertMember()` / project-level access checks. The guard + service check are stronger gates than IP throttling.

Current:
- `GET /issues` (board/backlog refetch on filter/search)
- `GET /issues/:id/activity` (opens on every issue modal)

## FE 429 handling
- Axios interceptor at `jira-fe/src/lib/api/client.ts` auto-retries GET with `Retry-After` or exponential backoff `[1s, 2s, 4s]` (max 3). POST/PATCH/DELETE reject immediately.
- BE SHOULD emit `Retry-After` header on 429 when possible so the FE backoff is tight.
- FE i18n key `messages.TOO_MANY_REQUESTS` is the user-facing toast.

## Adding a new endpoint — checklist
1. Is this auth-sensitive (password, OTP, session)? → explicit `@Throttle` at 3–10/min.
2. Is this an upload? → see upload.md + `@Throttle` 3–10/min.
3. Is this an authenticated read that the UI refetches aggressively? → `@SkipThrottle()` is OK if service enforces membership.
4. Everything else: inherit global 60/min.
