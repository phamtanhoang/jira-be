---
description: Pre-flight checklist for deploying BE changes to production. Walks through typecheck → lint → migrate prod → push → verify health.
---

# Deploy BE to Production

This is the production deploy runbook. Execute step-by-step — don't skip.

## 0. Confirm changes are intentional

```bash
git status
git diff --stat HEAD
```

Anything unexpected? Stash or commit before continuing.

## 1. Local quality gates

```bash
npx tsc --noEmit -p tsconfig.json     # typecheck — must pass
npx eslint "{src,apps,libs,test}/**/*.ts"   # lint — must pass
# (Optional) npm run test:run
```

If gates fail → fix, re-run, don't push broken code.

## 2. If schema changed: migrate production BEFORE pushing code

CRITICAL — see `.claude/rules/migration-deploy.md`. If your commit includes new `prisma/migrations/<ts>_<name>/`, you MUST apply it to prod DB BEFORE the container restart, or BE crashes on boot.

```powershell
# Local Windows — use DIRECT URL (toggle OFF "Connection pooling" in Neon)
$env:DATABASE_URL='postgresql://neondb_owner:<PASSWORD>@ep-<id>.<region>.aws.neon.tech/neondb?sslmode=require'

npx prisma migrate status              # see what's pending
npx prisma migrate deploy              # apply

Remove-Item Env:DATABASE_URL
```

If no schema change in this commit, skip this section.

## 3. Push to git

```bash
git add <changed files>
git commit -m "<type>(<scope>): <subject>"
git push origin <branch>
```

Commit message format (we use Conventional Commits):
- `feat(<scope>): <subject>` — new feature
- `fix(<scope>): <subject>` — bug fix
- `refactor(<scope>): <subject>` — non-functional change
- `perf(<scope>): <subject>` — performance
- `chore(<scope>): <subject>` — tooling, deps
- `docs(<scope>): <subject>` — docs only
- `ci(<scope>): <subject>` — CI workflow changes

## 4. Watch CI

GitHub Actions builds the Docker image + SSH'es into the VPS + restarts. Takes ~3–5 min.

Watch via GitHub UI OR:
```bash
gh run watch
```

## 5. Verify

```powershell
# Health (no DB query — just process aliveness)
curl.exe https://api.jira.3hteam.io.vn/health

# Open the app, smoke-test
# - Sign in
# - Create something
# - Check /admin/logs for new events
```

If something looks broken:
- Read `/admin/logs` filter `source=backend, level=ERROR`
- SSH VPS, `docker compose logs --tail=100 jira-be | grep -i error`

## 6. Rollback (if needed)

```bash
git revert <bad-commit>
git push
# CI auto-deploys the revert.
```

For a hot revert (don't want to wait for CI):
```bash
ssh hoangpham@vps
docker compose pull jira-be    # pull the previous tag if you have one
docker compose up -d --force-recreate jira-be
```

Migrations are forward-only — if the bad commit included a destructive migration, write a NEW migration that reverses the change. Don't try to "rollback" a migration.

## Pitfalls

- ❌ Pushing code with new migration WITHOUT step 2 → BE crash storm. Don't.
- ❌ Using pooled URL for `migrate deploy` → `P1002 advisory lock timeout`. Use direct URL.
- ❌ Skipping verification — pretty sure your change works on local ≠ works on prod.
