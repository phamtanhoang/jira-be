# Backend `.claude/` Navigation Index

The single map of every doc / agent / skill / command / rule. When you don't know where to look, start here.

## When to read what

| Goal | Start here |
|---|---|
| First session in this repo / first 15 minutes onboarding | [ONBOARDING.md](ONBOARDING.md) |
| Architecture overview, conventions, what-easy-to-get-wrong | [CLAUDE.md](CLAUDE.md) |
| Building / shipping a change | [skills/new-module.md](skills/new-module.md) |
| Debugging a defect | [skills/bug-fix-flow.md](skills/bug-fix-flow.md) |
| Restructuring without behavior change | [skills/refactor-flow.md](skills/refactor-flow.md) |
| Triaging a prod incident | [commands/diagnose-prod.md](commands/diagnose-prod.md) + [skills/investigate-prod.md](skills/investigate-prod.md) |
| Deploying to prod | [commands/deploy.md](commands/deploy.md) |
| Applying a Prisma migration | [commands/migrate.md](commands/migrate.md) + [rules/migration-deploy.md](rules/migration-deploy.md) |
| Adding a new admin setting | [rules/settings-toggles.md](rules/settings-toggles.md) |
| Adding a new event log event | [rules/event-logging.md](rules/event-logging.md) |
| Adding an upload endpoint | [rules/upload.md](rules/upload.md) + [rules/large-upload.md](rules/large-upload.md) |
| Adding a webhook event | [rules/webhook-events.md](rules/webhook-events.md) |
| Adding a cache wrapper | [rules/cache.md](rules/cache.md) |
| Adding a cron | [rules/cron.md](rules/cron.md) |
| Adding a service / splitting a big one | [rules/service-design.md](rules/service-design.md) |

## Files

### Top-level

| File | Purpose |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Canonical project guide. Architecture, conventions, "things easy to get wrong". |
| [CLAUDE.local.md](CLAUDE.local.md) | Local-only env notes — NOT committed. |
| [ONBOARDING.md](ONBOARDING.md) | 15-minute productivity ramp for new devs / Claude sessions. |
| [RULES_INDEX.md](RULES_INDEX.md) | This file. Navigation hub. |
| [memory.md](memory.md) | Long-term project memory — past decisions + nuance. |

### `rules/` — domain rules

Read the relevant rule before changing code in that area.

| Rule | Use when |
|---|---|
| [audit-log.md](rules/audit-log.md) | Adding an admin-visible destructive action |
| [cache.md](rules/cache.md) | Wrapping a hot read or invalidating a cached value |
| [cron.md](rules/cron.md) | Adding / modifying a scheduled job |
| [event-logging.md](rules/event-logging.md) | Adding an event (auth, security, perf, error) |
| [exceptions.md](rules/exceptions.md) | Adding a domain exception with stable error code |
| [large-upload.md](rules/large-upload.md) | Touching the chunked upload pipeline |
| [logging.md](rules/logging.md) | Anything around `RequestLog` / sanitization / Sentry |
| [migration-deploy.md](rules/migration-deploy.md) | Schema change or deploy involving a migration |
| [module-structure.md](rules/module-structure.md) | Module folder layout |
| [prisma-usage.md](rules/prisma-usage.md) | Querying via Prisma — selects, transactions, enums |
| [response-format.md](rules/response-format.md) | API response shape (always `{ message, ...data }`) |
| [service-design.md](rules/service-design.md) | Service grew past ~500 LOC, split decision |
| [settings-toggles.md](rules/settings-toggles.md) | Adding a runtime-tunable setting + snapshot pattern |
| [throttle.md](rules/throttle.md) | Adding `@Throttle()` to a new route |
| [upload.md](rules/upload.md) | Adding a file-upload endpoint |
| [webhook-events.md](rules/webhook-events.md) | Adding a webhook event or modifying dispatch |
| [prompt-defense.md](rules/prompt-defense.md) | Processing untrusted content (URLs, issue bodies, user-submitted text) |

### `agents/` — specialized assistants

Invoke via `Agent({ subagent_type: "general-purpose", description: "...", prompt: "..." })` with the agent's instructions in mind.

| Agent | When to use |
|---|---|
| [debugger.md](agents/debugger.md) | A bug whose root cause isn't obvious from the stack trace |
| [reviewer.md](agents/reviewer.md) | Second-opinion code review before merge |
| [migration-helper.md](agents/migration-helper.md) | Designing / reviewing a Prisma migration |
| [test-runner.md](agents/test-runner.md) | Running typecheck + lint + jest in one go |

### `skills/` — repeatable workflows

| Skill | When to use |
|---|---|
| [new-module.md](skills/new-module.md) | Scaffolding a new NestJS module |
| [bug-fix-flow.md](skills/bug-fix-flow.md) | Working through a BE defect |
| [refactor-flow.md](skills/refactor-flow.md) | Restructuring without behavior change |
| [investigate-prod.md](skills/investigate-prod.md) | Triaging a prod incident |

### `commands/` — slash-command runbooks

Invoke via `/<name>` at the Claude Code prompt.

| Command | What it does |
|---|---|
| [/deploy](commands/deploy.md) | Pre-flight deploy checklist |
| [/migrate](commands/migrate.md) | Apply pending Prisma migration to prod |
| [/seed](commands/seed.md) | Run `prisma db seed` (idempotent) |
| [/diagnose-prod](commands/diagnose-prod.md) | Triage prod issue step-by-step |
| [/quality-gate](commands/quality-gate.md) | Run typecheck + lint + test before commit |
| [/checkpoint](commands/checkpoint.md) | Mid-feature commit with Conventional Commits |
| [/learn](commands/learn.md) | Capture a non-obvious decision into memory.md |
| [/security-scan](commands/security-scan.md) | Scan for leaked secrets in `.claude/` + config |

### `hooks/` — trigger-based automations

| Hook | Event | Purpose |
|---|---|---|
| `session-start.js` | `SessionStart` | Print branch + commits + recent migrations |
| `post-edit-prisma.js` | `PostToolUse` on `prisma/*.prisma` | Remind to run `migrate dev` |
| `post-edit-sensitive.js` | `PostToolUse` on `*.dto.ts` | Remind to update `SENSITIVE_KEYS` |

See [hooks/README.md](hooks/README.md) for the contract.

### `specs/` — historical decisions

One-off design docs / RFCs that don't fit a rule. Reference only; read selectively.

## How the system fits together

```
┌──────────────────────────────────────────────┐
│ CLAUDE.md         ← always loaded            │
│ ONBOARDING.md     ← read once on first session│
│ RULES_INDEX.md    ← this file (navigation)    │
└──────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────┐
│ Doing a task? Pick a skill:                  │
│   new-module / bug-fix-flow /                │
│   refactor-flow / investigate-prod           │
└──────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────┐
│ Touching specific area? Read the rule:       │
│   migration-deploy / event-logging /         │
│   upload / cache / throttle / ...            │
└──────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────┐
│ Need help? Delegate to an agent:             │
│   debugger / reviewer / migration-helper     │
└──────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────┐
│ Running ops? Use a slash command:            │
│   /deploy /migrate /seed /diagnose-prod      │
└──────────────────────────────────────────────┘
```

## Updating this index

When you add a new rule / agent / skill / command, add a one-line entry above. The index is the contract — a file missing from here is invisible to future sessions.
