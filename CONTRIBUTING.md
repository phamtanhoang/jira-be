# Contributing to Jira Clone Backend

Thanks for your interest in contributing! This guide gets you from clone to merged PR.

## Quick start

```bash
git clone <repo-url> jira-be
cd jira-be
cp .env.example .env       # fill in DATABASE_URL + Resend + Supabase keys
npm install
npx prisma migrate dev     # apply schema to your DB
npm run start:dev          # boots on port 3031, watch mode
```

Swagger UI at http://localhost:3031/api once running.

## Stack

- **Framework**: NestJS 11 + TypeScript 5 (strict mode)
- **DB**: PostgreSQL via Prisma 7 (PG adapter)
- **Auth**: JWT in httpOnly cookies + Passport (Google/GitHub OAuth)
- **Cache**: Optional Redis (`REDIS_URL`); falls back to in-memory map
- **Email**: Resend
- **Storage**: Supabase Storage
- **Logging**: NestJS Logger + RequestLog DB rows + Sentry (5xx only, prod only)

## Folder layout

```
src/
├── core/                # cross-cutting infra (cache, constants, exceptions, filters, guards, interceptors, mail, services, types, utils, database)
└── modules/             # feature modules (auth, workspaces, projects, issues, ...)
```

Every module: `xxx.module.ts` + `xxx.controller.ts` + `xxx.service.ts` + `dto/`. See `.claude/rules/module-structure.md`.

## Pull request checklist

Before opening a PR:

- [ ] `npm run lint` passes (auto-fixes import order)
- [ ] `npm run type-check` passes (full TS strict mode enabled)
- [ ] `npm run test:run` green
- [ ] Manual smoke test relevant flow (`npm run start:dev` + try in browser/Swagger)
- [ ] If new endpoint: `@ApiTags` + `@ApiOperation` for Swagger docs
- [ ] If new DTO field: validators (`@IsString`, `@IsOptional`, ...) + `@ApiProperty`
- [ ] If sensitive field added: also add to `SENSITIVE_KEYS` in `src/core/utils/sanitize.util.ts`
- [ ] Follow response shape `{ message: MSG.SUCCESS.X, ...data }`
- [ ] Multi-step DB ops wrapped in `$transaction`

## Conventions (the bare minimum)

- **No `console.log`** — use NestJS `Logger`. See `src/core/utils/storage.util.ts` for module-scope, `auth.service.ts` for class-level patterns.
- **No `as any`** — use Prisma enums (`IssueType`, `IssuePriority`, `Prisma.QueryMode`).
- **Prisma selects from constants** — `USER_SELECT_BASIC`, `BOARD_COLUMN_SELECT` from `@/core/constants`. Never inline `{ select: { id: true, name: true } }`.
- **MSG keys for messages** — `MSG.SUCCESS.X`, `MSG.ERROR.Y` from `@/core/constants/message.constant.ts`. Never raw strings.
- **Domain exceptions over built-in** — use `IssueNotFoundException` etc. from `@/core/exceptions` when stable `errorCode` matters for FE branching.

Detailed rules in `.claude/rules/*.md` (8 files covering audit logs, exceptions, logging, prisma-usage, response format, service design, throttle, upload).

## Commit style

Conventional-ish — lead with verb, present tense:

```
feat(issues): add bulk delete endpoint
fix(auth): preserve OTP across re-sends
chore: bump dep
docs: clarify ARCHITECTURE.md
refactor(cache): reduce wrap signature
```

## Reporting issues

Open a GitHub issue with: reproduction steps, expected vs actual, NestJS startup logs if relevant. For security issues, see [SECURITY.md](./SECURITY.md) — do **not** open a public issue.

## Architecture deep-dive

See [ARCHITECTURE.md](./ARCHITECTURE.md) for module dependency graph, façade rationale (IssuesService split), cache tag matrix, and request lifecycle.
