# Onboarding — Jira Clone Backend (jira-be)

Welcome to the team. This doc gets a new dev (or a new Claude Code session) productive in ~15 minutes. Read this **first** before opening tickets.

## TL;DR — the 5 most important things

1. **NestJS 11 + Prisma 7 + Postgres**. Path alias `@/*` → `./src/*`. Controllers are thin, services do the work, Prisma is the data layer.
2. **Response shape is always `{ message: MSG.SUCCESS.X, ...data }`** — no raw returns. FE relies on this.
3. **Throw NestJS exceptions, never `res.status().json()`** — the global filter formats them consistently.
4. **Use shared select constants** (`USER_SELECT_BASIC`, `USER_SELECT_FULL`, `BOARD_COLUMN_SELECT`) — never inline.
5. **Multi-step writes go in `$transaction`** — atomicity is non-negotiable for state + activity row pairs.

## First-time setup

```bash
# Clone, install
git clone <repo>
cd jira-be
npm install

# Copy env template
cp .env.example .env
# Fill in DATABASE_URL (Neon or local Postgres), JWT_SECRET, RESEND_API_KEY,
# SUPABASE_URL + SUPABASE_SERVICE_KEY + SUPABASE_STORAGE_BUCKET

# Generate Prisma client + apply migrations + seed
npx prisma generate
npx prisma migrate deploy
npx prisma db seed   # creates admin@example.com / Admin@12345 + 8 Setting rows

# Run
npm run start:dev    # Port from PORT env (default 3031), Swagger at /api
```

Login at FE `/sign-in` with `admin@example.com` / `Admin@12345` → change password immediately at `/profile`.

## Repo map (memorize this)

```
src/
├── main.ts                # Bootstrap: Sentry, Helmet, CORS, ValidationPipe, Swagger
├── app.module.ts          # Wire-up: ThrottlerModule, ScheduleModule, all feature modules + global guards/interceptors/filter
├── core/                  # Cross-cutting infrastructure
│   ├── cache/             # CacheTagsService (Redis or in-memory)
│   ├── constants/         # ENV, MSG, ENDPOINTS, SELECT presets, UPLOAD_LIMITS, SETTING_KEYS
│   ├── database/          # PrismaService (@Global, PG adapter)
│   ├── decorators/        # @CurrentUser, @Public, @Roles
│   ├── exceptions/        # BaseAppException subclasses (FE consumes stable `errorCode`)
│   ├── filters/           # AllExceptionsFilter — formats every thrown exception
│   ├── guards/            # JwtAuthGuard (respects @Public), RolesGuard, OverridableThrottlerGuard
│   ├── interceptors/      # TimezoneInterceptor (x-timezone header), RequestLoggerInterceptor (events)
│   ├── mail/              # MailService + MailLogService — Resend / SMTP
│   ├── services/          # SentryService thin wrapper
│   ├── types/             # AuthUser type (passed by JwtStrategy)
│   └── utils/             # sanitize, hashPassword, storage helpers, timezone, csv
└── modules/
    ├── auth/              # signup → verify → login → refresh → logout
    ├── workspaces/        # Roles OWNER/ADMIN/MEMBER/VIEWER. Exports WorkspacesService for cross-module access checks
    ├── projects/          # Roles LEAD/ADMIN/DEVELOPER/VIEWER. Auto-creates Board on POST
    ├── boards/            # Column CRUD + reorder
    ├── sprints/           # PLANNING → ACTIVE → COMPLETED, only 1 active per board
    ├── issues/            # CRUD + move + labels + search + activity. Auto-key PROJECT-N atomically
    ├── labels/            # Project-scoped
    ├── comments/          # Threaded (parentId), author-only edit/delete
    ├── worklogs/          # Time in seconds, author-only edit/delete
    ├── attachments/       # Small (single-shot) attachments + signed URLs
    ├── attachments-large/ # Chunked / resumable upload (DB-backed sessions)
    ├── settings/          # Key-value JSON store
    ├── logs/              # Event-driven RequestLog + EventLoggerService
    ├── logging-config/    # Admin toggles per log channel
    ├── admin-audit/       # Destructive admin action audit log
    ├── users/             # ADMIN-only user mgmt + /admin/stats
    ├── feature-flags/     # Boolean flag CRUD
    ├── webhooks/          # Outbound delivery (Slack-style payload)
    └── ...
```

## Where to look for what

| I want to... | Open... |
|---|---|
| Add a new feature module | `.claude/skills/new-module.md` |
| Add a new exception class | `.claude/rules/exceptions.md` |
| Add a Prisma migration | `.claude/rules/prisma-usage.md` + `.claude/commands/migrate.md` |
| Wire a new logged event | `.claude/rules/logging.md` + `src/modules/logs/event-logger.service.ts` |
| Add a cron job | `.claude/rules/cron.md` |
| Add a webhook event | `.claude/rules/webhook-events.md` |
| Bump a throttle limit | `.claude/rules/throttle.md` |
| Add an upload endpoint | `.claude/rules/upload.md` |
| Deploy to production | `.claude/commands/deploy.md` |
| Diagnose prod 500s | `.claude/commands/diagnose-prod.md` |

## Conventions cheat sheet

### Controller (1 file per resource type)
```ts
@ApiTags('Issues')
@Controller(ENDPOINTS.ISSUES.BASE)
export class IssuesController {
  constructor(private issues: IssuesService) {}

  @Post()
  @ApiOperation({ summary: 'Create an issue' })
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateIssueDto) {
    const issue = await this.issues.create(user.id, dto);
    return { message: MSG.SUCCESS.ISSUE_CREATED, issue };
  }
}
```

### Service (where the work happens)
```ts
@Injectable()
export class IssuesService {
  constructor(
    private prisma: PrismaService,
    private workspaces: WorkspacesService,
    private events: EventLoggerService,
  ) {}

  async create(userId: string, dto: CreateIssueDto) {
    await this.workspaces.assertMember(dto.workspaceId, userId);

    return this.prisma.$transaction(async (tx) => {
      const issue = await tx.issue.create({
        data: { ... },
        include: { reporter: USER_SELECT_BASIC, assignee: USER_SELECT_BASIC },
      });
      await tx.activity.create({
        data: { issueId: issue.id, userId, action: ActivityAction.CREATED },
      });
      return issue;
    });
  }
}
```

### DTO (validation lives here)
```ts
import { IsString, IsOptional, MaxLength, IsEnum, IsUUID } from 'class-validator';

export class CreateIssueDto {
  @IsUUID() projectId!: string;
  @IsString() @MaxLength(255) summary!: string;
  @IsOptional() @IsString() description?: string;
  @IsEnum(IssueType) type!: IssueType;
}
```

## Deploy flow (production)

The CI pipeline (GitHub Actions) builds + pushes a Docker image, then SSH'es into the VPS to `docker compose pull && up -d`. But **migrations don't auto-run** — you must do them by hand:

```powershell
# Local Windows
cd e:\jira\jira-be
$env:DATABASE_URL='<DIRECT_URL_FROM_NEON_WITH_POOLING_OFF>'
npx prisma migrate status     # see what's pending
npx prisma migrate deploy     # apply
Remove-Item Env:DATABASE_URL

# Then push code
git push   # CI builds image, deploys, restarts container
```

If you push code with a schema change but forget to migrate prod first, the BE will crash on every request with `column X does not exist`. Always migrate **before** the container restart.

See `.claude/commands/deploy.md` for the full checklist.

## Common pitfalls (learn from past pain)

1. **Forgetting `assertMember()`** — service writes WITHOUT access check = data leak across tenants. Run the reviewer agent before merging.
2. **Inlining `select: { id: true, name: true, image: true }`** — there's a constant for that (`USER_SELECT_BASIC`). The reviewer flags this.
3. **Calling `this.audit.log(...)` with `await`** — it's fire-and-forget by design. `await`-ing couples your request latency to audit DB writes.
4. **Logging sensitive fields without adding to `SENSITIVE_KEYS`** — values land in `RequestLog` plaintext. Always update `src/core/utils/sanitize.util.ts`.
5. **Using `as any` for Prisma types** — banned. Use the enum (`IssueType`, `IssuePriority`, `Prisma.QueryMode`).
6. **Pooled URL for `prisma migrate`** — fails with advisory-lock timeout. Always use the direct URL (Neon: disable "Connection pooling" toggle in Connect dialog).

## Test data — for HR / interview / demos

`admin@example.com` / `Admin@12345` (change before sharing) is created by `prisma db seed`. To seed a richer dataset (sample workspace, project, issues, sprint):

```bash
npm run seed:demo   # TODO: add this script if you need richer demo data
```

## Need help?

- Spec docs: `.claude/specs/*.md` — historical context on past features
- Memory: `.claude/memory.md` — non-obvious patterns learned the hard way
- Rules: `.claude/rules/*.md` — must-follow conventions, indexed in `RULES_INDEX.md`
- Agents: `.claude/agents/*.md` — Claude sub-agents you can invoke (`debugger`, `reviewer`, ...)
- Commands: `.claude/commands/*.md` — slash commands for common workflows

When Claude Code starts a new session, it reads `CLAUDE.md` automatically. The first thing you should do as a human is open `.claude/ONBOARDING.md` (this file) and skim the cheat sheet sections.
