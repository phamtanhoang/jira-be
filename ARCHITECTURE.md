# Architecture — `jira-be`

High-level map of how the backend hangs together. See `.claude/rules/*.md` for prescriptive coding rules; this doc explains *why* the code looks the way it does.

## Request lifecycle

```
HTTP request
  │
  ▼
[ Helmet + CORS + ValidationPipe ]   (main.ts)
  │
  ▼
[ Global guards ]                     ─ JwtAuthGuard (cookie OR Bearer JWT/PAT)
                                      ─ RolesGuard (@Roles)
                                      ─ OverridableThrottlerGuard
  │
  ▼
[ Global interceptors ]               ─ TimezoneInterceptor (x-timezone → request)
                                      ─ RequestLoggerInterceptor (success → RequestLog)
  │
  ▼
[ Controller @Method handler ]        ─ thin: validates DTO, delegates to service
  │
  ▼
[ Service layer ]                     ─ business logic + Prisma calls (or Repository pilot)
  │
  ▼
[ Prisma → PostgreSQL ]               ─ multi-step ops wrapped in $transaction
  │
  ▼
[ Response shape ]                    ─ { message: MSG.SUCCESS.X, ...data }
  │
  ▼
[ AllExceptionsFilter on error ]      ─ logs to RequestLog + Sentry (5xx only, prod only)
                                       ─ surfaces errorCode for BaseAppException subclasses
```

## Module organization

```
src/
├── core/                      Cross-cutting infra (no business domain)
│   ├── cache/                 AppCacheModule (global) + CacheTagsService
│   ├── constants/             ENV, MSG, ENDPOINTS, COOKIE_KEYS, REGEX, SETTING_KEYS,
│   │                          USER_SELECT_*, BOARD_COLUMN_SELECT, time.constant.ts
│   ├── database/              PrismaService (global)
│   ├── decorators/            @CurrentUser, @Public, @Roles
│   ├── exceptions/            BaseAppException + 5 domain subclasses
│   ├── filters/               AllExceptionsFilter
│   ├── guards/                JwtAuthGuard, RolesGuard, OverridableThrottlerGuard
│   ├── interceptors/          TimezoneInterceptor, RequestLoggerInterceptor
│   ├── mail/                  MailService (Resend wrapper, transport caching)
│   ├── services/              SentryService (no-op when DSN missing or NODE_ENV !== production)
│   ├── types/                 AuthUser
│   └── utils/                 hashPassword, generateOTP, sanitize, storage,
│                              parse-mentions, csv-escape, …
│
└── modules/                   Business domain (one folder per resource)
    ├── auth/                  signin/signup/verify, OAuth, refresh, profile, sessions
    ├── workspaces/            CRUD + members. Roles: OWNER > ADMIN > MEMBER > VIEWER
    ├── projects/              CRUD + members. Roles: LEAD > ADMIN > DEVELOPER > VIEWER
    │                          + projects.repository.ts (pilot)
    ├── boards/                Column CRUD + reorder
    ├── sprints/               PLANNING → ACTIVE → COMPLETED, velocity, burndown, CFD
    ├── issues/                ⚡ FAÇADE — see "Issues façade" below
    ├── labels/, comments/, worklogs/, attachments/, notifications/,
    ├── settings/, logs/, users/, admin-audit/, feature-flags/,
    ├── invite-links/, saved-filters/, issue-templates/, push/,
    ├── personal-access-tokens/, webhooks/, throttle-overrides/,
    ├── recurring-issues/, custom-fields/, gdpr/,
    ├── public/                @Public read endpoints (share tokens)
    ├── health/                Public /health (uptime monitor) — reuses AdminService
    └── debug/                 Sentry test endpoint
```

## Issues façade

`IssuesService` historically contained ~1164 LOC. After refactor it's a façade that
delegates to focused sub-services so each unit fits in one screen and tests can mock
narrow dependencies.

```
IssuesService (façade — public API)
   │
   ├── IssuesService internal: create, update, move, delete, find* (CRUD core),
   │   findStarredIds, findMyDashboard,
   │   buildCustomFieldClauses (private), fireIssueWebhook (private)
   │
   ├── IssuesActivityService    findActivity (uses IssuesRepository.resolveActivityRefs)
   ├── IssuesBulkService        bulkUpdate, bulkDelete
   ├── IssuesExportService      exportCsv
   ├── IssuesLabelsService      addLabel, removeLabel
   ├── IssuesLinksService       createLink, deleteLink
   ├── IssuesShareService       createShareToken, listShareTokens, revokeShareToken,
   │                            findByShareToken (public read)
   └── IssuesWatchersService    star/unstar, watch/unwatch, findWatchers, autoWatch
```

Sub-services depend back on `IssuesService` for the shared `findById` access check
(workspace + project membership). The cycle is broken via NestJS `forwardRef()` —
acceptable here because all classes live in the same module and are co-managed.

`comments.service.ts` is the only external caller of `IssuesService.autoWatch` —
the façade preserves that signature so the comment flow stays unaware of the split.

## Cache tag matrix

`CacheTagsService` (Redis-backed when `REDIS_URL` set, in-memory map otherwise) maintains
parallel sets of cache keys per tag. Mutations call `invalidateTag(...)` once;
the service walks the set and deletes all keys.

| Endpoint                            | Cache key                                | TTL  | Tags                               |
|-------------------------------------|------------------------------------------|------|------------------------------------|
| `WorkspacesService.findAllByUser`   | `ws:list:user:<userId>`                  | 60s  | `user:<userId>`, `workspaces`      |
| `ProjectsService.findAllByWorkspace`| `proj:list:ws:<wsId>:user:<userId>`      | 60s  | `workspace:<wsId>`, `user:<userId>`|
| `IssuesService.findByKey`           | `issue:key:<key>:user:<userId>`          | 300s | `issue:key:<key>`                  |
| `IssuesActivityService.findActivity`| `issue:activity:<id>`                    | 60s  | `issue:id:<id>`                    |
| `SettingsService.getAppInfo`        | `setting:app.info`                       | 600s | `settings`                         |

Mutation → invalidation map:
- Workspace `create / update / delete / addMember / removeMember` → `user:<userId>` + `workspace:<wsId>`
- Project `create / update / delete / addMember / bulkAddMembers` → `workspace:<wsId>`
- Issue `update / move / delete` → `issue:id:<id>` + `issue:key:<key>`
- Setting `setByKey / uploadAppLogo` → `settings`

Kill switch: `CACHE_DISABLED=1` env var → wrap/invalidate become no-ops.
Use it to confirm whether stale data is from cache or upstream.

## Logging pipeline

```
HTTP success ─→ RequestLoggerInterceptor.intercept
                   ↓ enqueue (sync push to in-memory ring buffer, cap 500)
                LogsService — flushes every 2s OR at 50 entries via prisma.requestLog.createMany

HTTP error ───→ AllExceptionsFilter.catch
                   ↓ enqueue same buffer; 5xx also forwarded to SentryService
                SentryService — no-op unless SENTRY_DSN set AND NODE_ENV === production
                              — returned eventId stored on RequestLog row for cross-link

Logging is fire-and-forget. enqueue() is a synchronous push to a JS array — it cannot fail.
The flush task wraps prisma.createMany in try/catch and swallows errors so DB outages
never block HTTP responses.
```

PII protection: `sanitize()` recursively masks `password / token / otp / refreshToken /
authorization / cookie / apiKey` keys. Auth routes (`/auth/login` etc.) drop the
request body entirely before persisting. See `src/core/utils/sanitize.util.ts`.

## Auth flow

```
register → bcrypt(12) hash → email OTP (Resend)
verify   → match OTP → user.emailVerified = now() → tokens deleted
login    → bcrypt.compare → JWT signed with JWT_SECRET → httpOnly+secure+sameSite cookies
refresh  → cookie → DB lookup → rotate (delete old + insert new) → new cookies
JWT extraction priority: access_token cookie → Authorization: Bearer header
                       → Bearer pat_... (Personal Access Token, sha256-matched)
```

OAuth (Google + GitHub): `/auth/{provider}` redirects to upstream → callback hits
`AuthController.oauthCallback`, passes profile to `AuthService.loginWithOAuth`. Existing
user matched by email gets auto-linked + email-verified; new users created with random
password placeholder. `OAuthAccount` table records provider + providerId for unlink later.

## Permission layers

| Layer       | Mechanism                                                              | Source of truth         |
|-------------|------------------------------------------------------------------------|-------------------------|
| Platform    | `Role.USER` / `Role.ADMIN` enforced by `RolesGuard` + `@Roles(...)`    | `User.role` column      |
| Workspace   | `OWNER` / `ADMIN` / `MEMBER` / `VIEWER` via `workspacesService.assertMember()` / `assertRole()` | `WorkspaceMember.role`  |
| Project     | `LEAD` / `ADMIN` / `DEVELOPER` / `VIEWER` via `projectsService.assertRole()` | `ProjectMember.role`    |
| Resource    | Author-only (comments, worklogs) — checked inline in service methods   | `Comment.authorId` etc. |

Controllers must NEVER do permission checks themselves. The service is the single
gate so every code path (REST, future GraphQL, internal cron) goes through it.

## Database

PostgreSQL via Prisma 7. Schema split into multi-file shape under `prisma/*.prisma` —
one file per domain (issue, workspace, board, sprint, comment, …).

Cascading deletes everywhere: removing a Workspace deletes its Projects → Boards →
Issues → Comments / Worklogs / Activities. No soft-delete (yet — see `ROADMAP.md` 12.5).

Atomic operations:
- `Issue.create` — counter increment + issue insert + activity log all in one
  `$transaction(async tx => ...)`.
- `Issue.move` — column lookup + update + activity log atomic; notification fanout
  outside the transaction (best-effort).
- `Sprint.complete` — incomplete issues moved to backlog (`sprintId = null`) before
  the sprint flips to `COMPLETED`.

## Throttle defaults

Global: `60 req/minute` (1 req/s average). Per-route overrides via `@Throttle`:
- Auth endpoints: 3-5/min (login, register, forgot-password, verify-email)
- File upload: 3-10/min (avatar, attachments, logo)
- `/logs/client` ingest: 20/min
- `@SkipThrottle()` for authenticated read-heavy reads gated by `assertMember()`
  (`GET /issues`, `GET /issues/:id/activity`)

Admin can override per `user:<userId>` or `ip:<addr>` via `/admin/throttle`.
