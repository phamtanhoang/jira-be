# Prisma Migrations + Deploy Flow

The single biggest deploy footgun — get this wrong and prod 500s for everyone.

## Deploy sequence (always in this order)

```
1. Local: implement schema change in prisma/*.prisma
2. Local: npx prisma migrate dev --create-only --name <descriptive>
3. Local: review migration.sql, refine if destructive
4. Local: npx prisma generate (regenerate client)
5. Local: typecheck + lint pass
6. Local: git commit + push
7. CI: builds Docker image with new code + generated client
8. Local: npx prisma migrate deploy AGAINST PROD DB    ← critical
9. CI: pulls image on VPS, restarts container
10. Verify: curl /health + functional test
```

If you skip step 8, BE deploys with code expecting columns that don't exist → every request that touches that table 500s.

## Why CI doesn't auto-migrate

We considered adding `npx prisma migrate deploy` to the Docker entrypoint or a CI step. Decided against because:

1. **Prisma CLI is stripped in production image** — moves to devDeps to keep image small. Re-adding bumps image ~20MB.
2. **Coupling deploy timing to migration timing is risky** — if migration takes 30s and traffic comes in during, you have a window where new code hits old schema.
3. **Migrations sometimes need manual intervention** — adding NOT NULL to a populated column, large data backfills. Auto-apply is for sterile environments.

So the human runs migrations explicitly. The trade-off is one extra step in exchange for explicit control.

## Pooled vs direct connection

Neon offers two URLs for the same DB:
- **Pooled** (`-pooler.c-2.<region>...`) — through pgBouncer in transaction mode. Use for BE runtime (better connection scaling).
- **Direct** (no `-pooler`) — straight to the compute. Use for `prisma migrate`.

Migrations use Postgres `pg_advisory_lock(72707369)` to prevent concurrent runs. The pooler in transaction mode doesn't hold session state across statements → advisory lock times out → migration fails with `P1002`.

To migrate, override `DATABASE_URL` with the direct URL:

```powershell
# Local Windows
cd e:\jira\jira-be
$env:DATABASE_URL='postgresql://neondb_owner:<pwd>@ep-<id>.ap-southeast-1.aws.neon.tech/neondb?sslmode=require'
npx prisma migrate status     # check what's pending
npx prisma migrate deploy
Remove-Item Env:DATABASE_URL
```

(Get the direct URL: Neon Dashboard → Connect → toggle OFF "Connection pooling".)

## Safe migration types (apply anytime)

| Type | Safe? | Notes |
|---|---|---|
| `ADD COLUMN x TYPE` (nullable) | ✅ yes | Backward compat — old rows have NULL |
| `ADD COLUMN x TYPE DEFAULT 'v'` | ✅ yes | Postgres backfills NULL with default |
| `CREATE INDEX CONCURRENTLY` | ✅ yes (Prisma doesn't use CONCURRENTLY by default though — see below) |
| `ADD CONSTRAINT NOT VALID` | ✅ yes | Validates new rows only; backfill happens later |
| `CREATE TABLE` | ✅ yes | Additive |
| `ADD COLUMN x TYPE NOT NULL` | ❌ unsafe | Fails if table has rows. Add nullable → backfill → set NOT NULL |
| `DROP COLUMN` | ⚠️ blocked by code | Make sure no deployed code reads the column. Two-step: deploy code without col → then drop |
| `ALTER COLUMN TYPE` | ⚠️ may rewrite table | Long lock. Use shadow table pattern for big tables |
| `ALTER TABLE RENAME` | ⚠️ blocked by code | Same as drop — must follow expand-contract pattern |

## Recommended pattern for destructive changes

Expand-contract:
1. **Expand**: add new column/table alongside old. Code writes to both.
2. **Backfill**: data migration script copies old → new.
3. **Code shift**: deploy code that reads from new only.
4. **Contract**: drop old column/table in a follow-up migration.

Never combine these into one migration.

## Local dev workflow

```bash
# After editing a *.prisma file
npx prisma migrate dev --name short_description
# This creates migration + APPLIES to local DB + regenerates client.
# Use --create-only to skip apply (when local DB is shared / production-like)
```

`migrate dev` will warn if it detects DRIFT (DB schema doesn't match migration history). Common cause: someone manually ran SQL on the DB. Fix: either redo via migration or `prisma db pull` to introspect → reconcile.

## Rollback

Prisma migrations are forward-only. To rollback:
1. Write a new migration that reverses the change (e.g. DROP COLUMN that was just ADD-ed).
2. Apply it forward.

Don't try to delete a migration folder + revert state — leaves DB out of sync with history table.

## Things easy to get wrong

- ❌ Pushing code with schema change WITHOUT running `migrate deploy` first → BE crashes after CI deploys.
- ❌ Using pooled URL for migrate → `P1002: advisory lock timeout`.
- ❌ Editing a migration SQL file after it's been applied somewhere → drift error on next `migrate deploy`.
- ❌ Running `migrate dev` against prod DB → resets migration history if drift detected. Use `migrate deploy` only on prod.
- ❌ Forgetting to commit the new `prisma/migrations/<ts>_<name>/migration.sql` folder. CI image build won't have it.
