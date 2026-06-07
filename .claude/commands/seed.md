---
description: Run prisma db seed against the current DATABASE_URL. Idempotent — safe to run multiple times.
---

# Run database seed

The seed script lives at `prisma/seed.ts`. It populates:
- 8 `Setting` rows with sensible defaults (`app.info`, `app.email`, `app.email_templates`, etc.)
- 1 admin user (default: `admin@example.com` / `Admin@12345`)

Both are idempotent: existing settings are kept (no overwrite); existing admin gets `role=ADMIN + emailVerified=now()` enforced but password NOT changed.

## Run against local / dev DB

```bash
cd jira-be
npx prisma db seed
```

`.env` `DATABASE_URL` is used. Make sure it points at your dev DB, not prod.

## Run against production (one-time setup)

Only needed on fresh prod DB (e.g. after migrating to self-host Postgres). NEVER run repeatedly on prod — it's safe but pointless.

```powershell
$env:DATABASE_URL='<PROD_DATABASE_URL>'
npx prisma db seed
Remove-Item Env:DATABASE_URL
```

## Override admin credentials
account: `admin@example.com / Admin@12345`


## What gets seeded

| Setting key | Default shape |
|---|---|
| `app.info` | `{ name: "Jira Clone", logoUrl: "", description, authorName, authorUrl }` |
| `app.email` | `{ provider: "resend", fromEmail: "onboarding@resend.dev", fromName: "Jira Clone", smtp: {...} }` |
| `app.features` | `{}` |
| `app.announcement` | `{ enabled: false, message: "", severity: "info" }` |
| `app.maintenance` | `{ enabled: false, message: "", allowedEmails: [] }` |
| `app.auth_providers` | `{ password: true, google: true, github: true }` |
| `app.quotas` | `{ maxProjectsPerWorkspace: 0, maxMembersPerWorkspace: 0, maxStorageGB: 0 }` (`0` = unlimited) |
| `app.email_templates` | `{ verification: {...}, resetPassword: {...}, welcome: {...} }` — full HTML defaults |

## Adding new seed data

Edit `prisma/seed.ts`. The pattern:

```ts
const SEED: Record<string, Prisma.InputJsonValue> = {
  // ...
  [SETTING_KEYS.YOUR_NEW_KEY]: { /* default value */ },
};
```

Idempotency lives in the loop: if a row exists for the key, it's `kept` (status from script output). To force-overwrite an existing row, delete it manually first (Prisma Studio or `psql`).
