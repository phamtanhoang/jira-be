# Jira Clone — Backend

NestJS project management API with JWT auth, role-based access, and real-time activity tracking.

## Tech Stack
- NestJS ^11.0.1, TypeScript ^5.7.3, Prisma ^7.6.0 (PostgreSQL adapter)
- Auth: @nestjs/jwt ^11.0.2, @nestjs/passport ^11.0.5, passport-jwt ^4.0.1, bcryptjs ^3.0.3
- Validation: class-validator ^0.15.1, class-transformer ^0.5.1
- Security: helmet ^8.1.0, @nestjs/throttler ^6.5.0
- Email: resend ^6.10.0

## Commands
```bash
npm run start:dev       # Dev server (port 4000, watch mode)
npm run build           # nest build && tsc-alias
npm run start:prod      # node dist/main
npx prisma migrate dev  # Run migrations
npx prisma studio       # DB GUI
npm run lint            # ESLint fix
npm run test            # Jest
```

## Directory Structure
```
src/
├── main.ts                 # Bootstrap: Sentry.init (if DSN), Helmet, CORS, ValidationPipe, Swagger at /api
├── app.module.ts           # Imports all modules. Global: JwtAuthGuard, RolesGuard, ThrottlerGuard, TimezoneInterceptor, RequestLoggerInterceptor, AllExceptionsFilter. ScheduleModule.forRoot() for cron.
├── core/
│   ├── constants/          # ENV, MSG, ENDPOINTS, COOKIE_KEYS, REGEX, SETTING_KEYS, USER_SELECT_BASIC/FULL, BOARD_COLUMN_SELECT
│   ├── database/           # PrismaService (global module, PG adapter)
│   ├── decorators/         # @CurrentUser(), @Public(), @Roles()
│   ├── filters/            # AllExceptionsFilter — @Injectable, logs errors to RequestLog + Sentry (5xx only)
│   ├── guards/             # JwtAuthGuard (respects @Public), RolesGuard (checks @Roles)
│   ├── interceptors/       # TimezoneInterceptor (x-timezone header), RequestLoggerInterceptor (success path → RequestLog)
│   ├── mail/               # MailService (Resend API), OTP email template
│   ├── services/           # SentryService (thin @sentry/nestjs wrapper, no-op if SENTRY_DSN missing)
│   ├── types/              # AuthUser {id, name, email, emailVerified, image, role, createdAt}
│   └── utils/              # hashPassword, generateOTP, cookieExtractor, timezone conversion, sanitize (recursive PII masker)
└── modules/
    ├── auth/               # register → verify-email → login → refresh → logout, forgot/reset password
    ├── workspaces/         # CRUD + members. Roles: OWNER > ADMIN > MEMBER > VIEWER. Exports WorkspacesService
    ├── projects/           # CRUD + members. Roles: LEAD > ADMIN > DEVELOPER > VIEWER. Auto-creates Board on create
    ├── boards/             # Column CRUD + reorder. Default columns: To Do, In Progress, Done
    ├── sprints/            # PLANNING → ACTIVE → COMPLETED. Only 1 active per board. Incomplete issues → backlog on complete
    ├── issues/             # CRUD + move (drag-drop) + labels. Auto key: PROJECT-N. Activity logged on every change
    ├── labels/             # Project-scoped, unique name per project, default color #6b778c
    ├── comments/           # Threaded (parentId). Author-only edit/delete. Activity logged
    ├── worklogs/           # Time in seconds. Author-only edit/delete. Activity logged
    ├── settings/           # Key-value JSON store. Keys: app.info, app.email. GET app-info is @Public
    └── logs/               # @Global. RequestLog persistence + GET /logs (ADMIN) + POST /logs/client (FE ingest). Buffered flush every 2s. @Cron(3AM) retention.
```

## Logging & Observability
- Every HTTP request → `RequestLog` row (success INFO, 4xx WARN, 5xx ERROR). Source tagged `backend` or `frontend`.
- `RequestLoggerInterceptor` logs success path; `AllExceptionsFilter` logs errors.
- Body/query sanitized via `sanitize()` — masks `password`, `token`, `otp`, `refreshToken`, `authorization`, etc.
- Auth routes (`/auth/login`, `/auth/register`, …) drop `requestBody` entirely.
- Only `status >= 500` mirrored to Sentry (free-tier friendly). `sentryEventId` stored on row for correlation.
- `@Cron(EVERY_DAY_AT_3AM)` deletes logs older than `ENV.LOG_RETENTION_EXPIRY` (default 30).
- In-memory buffer (cap 500); `createMany` every 2s or at 50 entries. Logging NEVER blocks request path.

## Auth Flow
1. Register: hash password (bcrypt 12) → create user (emailVerified=null) → OTP → email
2. Verify: check OTP + expiry → set emailVerified=now() → delete all tokens
3. Login: validate credentials → check emailVerified → sign JWT {sub, email} → set httpOnly cookies (access_token + refresh_token)
4. Refresh: extract refresh_token cookie → validate → rotate (delete old, create new) → set new cookies
5. JWT extracted from: access_token cookie (priority) OR Authorization Bearer header

## Permission System
- Global: Role.USER / Role.ADMIN — enforced by RolesGuard + @Roles()
- Workspace: OWNER/ADMIN/MEMBER/VIEWER — enforced by workspacesService.assertMember() / assertRole()
- Project: LEAD/ADMIN/DEVELOPER/VIEWER — enforced by projectsService.assertRole()
- Resource: author-only for comments/worklogs — checked in service methods

## Database
- PostgreSQL via Prisma with PG adapter
- 15 models, 10 enums, multi-file schema (prisma/*.prisma)
- Key relations: User → Workspace(owner) → Project → Board(1:1) → Columns/Sprints → Issues → Comments/Worklogs/Activity
- All foreign keys cascade on delete
- Issue.key is globally unique (e.g. PROJ-42), generated atomically via $transaction

## Environment
Required: `DATABASE_URL`, `PORT`, `JWT_SECRET`, `CORS_ORIGIN`, `RESEND_API_KEY`, Supabase keys.
Optional (logging): `SENTRY_DSN` (no-op if missing), `SENTRY_ENV`, `LOG_RETENTION_EXPIRY` (default 30).

## Things Easy to Get Wrong
- Response format is ALWAYS `{ message: MSG.SUCCESS.X, ...data }` — never raw data
- Error handling: ALWAYS throw NestJS exceptions — NEVER res.status().json()
- Prisma selects: ALWAYS use USER_SELECT_BASIC/FULL/BOARD_COLUMN_SELECT from constants — NEVER inline {id: true, name: true}
- Multi-step operations MUST use $transaction (issue create + activity, sprint complete + backlog move)
- NEVER use `as any` — use Prisma enums (IssueType, IssuePriority, Prisma.QueryMode)
- Rate limiting: auth endpoints have stricter @Throttle (register/login: 5/min, forgot-password: 3/min)
- Workspace owner CANNOT be removed — no transfer endpoint exists
- New issues auto-assign to first board column (position 0). If no columns exist, boardColumnId is null
- Sprint complete moves all non-DONE issues to backlog (sprintId = null)
- Description + comment content now contain HTML (from Tiptap editor on FE) — same DB fields, no schema change
- GET /issues?search= is used by FE global search (Cmd+K) — works without projectId filter
- PATCH /issues/:id with { sprintId } used by FE backlog DnD to assign/unassign sprints
- PATCH /issues/:id/move used by FE subtask checkbox to toggle Done/Todo columns
- PATCH /worklogs/:id used by FE inline worklog edit
- Logging: NEVER add a new sensitive field to DTOs without also adding its key to `SENSITIVE_KEYS` in `src/core/utils/sanitize.util.ts` — otherwise it will be logged in plaintext
- Logging: exceptions thrown in `AllExceptionsFilter.safeLog` / `RequestLoggerInterceptor.safeLog` MUST be swallowed — logging failure MUST NOT affect HTTP response
- Logging: all `GET /logs` / `GET /logs/:id` routes are `@Roles(Role.ADMIN)` — never expose without the decorator
