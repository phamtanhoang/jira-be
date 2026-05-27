---
description: Apply a pending Prisma migration to production DB. Use BEFORE pushing schema-change code.
---

# Apply Prisma migration to production

Read `.claude/rules/migration-deploy.md` first if unsure.

## Steps

1. **Confirm the migration exists locally**:
   ```bash
   ls prisma/migrations | tail -3
   cat prisma/migrations/<latest>/migration.sql
   ```

2. **Get direct URL from Neon**:
   - Open Neon dashboard → project → Connect
   - **Toggle OFF "Connection pooling"** (critical — pooled URL fails with advisory-lock timeout)
   - Copy the URL (hostname has no `-pooler` and no `.c-2.`)

3. **Apply**:
   ```powershell
   cd e:\jira\jira-be
   $env:DATABASE_URL='<DIRECT_URL_FROM_STEP_2>'
   
   # Verify what's pending
   npx prisma migrate status
   
   # Apply
   npx prisma migrate deploy
   
   # Clean up env var
   Remove-Item Env:DATABASE_URL
   ```

4. **Expected output**:
   ```
   Applying migration `<timestamp>_<name>`
   
   The following migration(s) have been applied:
   migrations/
     └─ <timestamp>_<name>/
       └─ migration.sql
   
   All migrations have been successfully applied.
   ```

5. **If `Database schema is up to date!`** — no pending. Probably you already applied. Safe to skip.

## After migrate

Now safe to push code:

```bash
git push origin <branch>
```

CI will deploy the new image. BE container restarts with code + schema that match.

## Rollback

Migrations are forward-only. If the migration was wrong:
1. Edit the prisma model to the OPPOSITE change.
2. `npx prisma migrate dev --create-only --name revert_<previous>`
3. Apply the new revert migration via the steps above.

NEVER edit a migration that's already been applied — drift error.

## Common failures

- `P1002` timeout → you used pooled URL. Switch to direct.
- `P3018` failed to apply → check the SQL. Often a column type mismatch or constraint conflict.
- `P3009` migration in dirty state → previous migrate was interrupted. `npx prisma migrate resolve --applied <name>` if you confirm DB is actually in the post-state.
