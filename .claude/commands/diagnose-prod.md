---
description: Triage a production issue. Walks through health check → BE logs → DB connectivity → recent deploy → known-bad-patterns checklist.
---

# Diagnose Production Issue

When prod is misbehaving (500s, hangs, login broken), don't guess. Follow this triage in order.

## 1. Health endpoint

```bash
curl -i https://api.jira.3hteam.io.vn/health
```

Expected:
```json
{"status":"ok","timestamp":"...","uptimeSec":N}
```

- `status: down` → BE running but degraded (rare with current shape since `/health` no longer queries DB).
- Connection refused / no response → BE container is down OR nginx misconfigured.

## 2. Container status (on VPS)

```bash
ssh hoangpham@vps
sudo docker compose -f ~/projects/jira/jira-be/docker-compose.yml ps

# If container exited / restarting, see why:
sudo docker compose logs --tail=50 jira-be
```

- `Exit (1)` → BE crashed at startup. Read tail of logs for the stack.
- `Restarting (1)` → crashing in a loop. Common cause: Prisma can't reach DB (network) OR schema drift.

## 3. Recent BE errors

```bash
sudo docker compose logs --since 30m jira-be | grep -B 1 -A 20 -i "error\|exception" | tail -100
```

Look for these archetypes:
- `column "X" does not exist` → missing migration. Run `.claude/commands/migrate.md`.
- `Can't reach database server` → DB unreachable. Check Neon dashboard for compute status / over-quota banner. Check VPS network to DB host.
- `JsonWebTokenError` → JWT_SECRET mismatch (rare unless env was changed).
- `ECONNREFUSED 127.0.0.1:5432` → if self-host Postgres, that container is down.

## 4. DB connectivity

If suspect DB:

```bash
# From VPS, try a quick query
sudo docker exec jira-be sh -c 'echo "SELECT 1" | npx prisma db execute --stdin --schema=/app/prisma'
```

OR if Neon:
- Open Neon dashboard → check for "Limit reached" / "Compute paused" banner.
- Check Monitoring tab for `Active time` collapsed = compute suspended.

## 5. Admin event-log

Login as admin → `/admin/logs` → filter `source=backend, level=ERROR` → click the recent error row.

The `errorStack` field has the full trace + Sentry event ID for cross-reference.

## 6. Recent deploys

```bash
git log --oneline -10
gh run list --limit 5     # CI runs
```

If a commit was deployed recently, that's usually the culprit. Rollback:

```bash
git revert <bad-sha>
git push     # CI auto-deploys
```

## 7. Specific patterns

| Symptom | Diagnose | Fix |
|---|---|---|
| 500 on every request | Schema drift OR DB down | `prisma migrate status`, check DB |
| 500 on /complete (upload) | Supabase storage flaky | Check `/admin/logs` for `error.5xx` + Sentry. Sometimes self-heals on retry |
| 401 loop | JWT_SECRET changed → all sessions invalid | Tell users to re-login, OR revert JWT_SECRET change |
| 429 on legitimate traffic | Throttle too strict | Bump per-route `@Throttle` |
| Upload 413 | nginx body limit | Verify `client_max_body_size` in nginx config, OR lower `chunkSize` in `upload.constant.ts` |
| /admin/logs 500 | Common: schema drift on RequestLog | `prisma migrate deploy` |

## 8. Last resort — full restart

```bash
ssh hoangpham@vps
cd ~/projects/jira/jira-be
sudo docker compose down
sudo docker compose pull
sudo docker compose up -d
sudo docker compose logs -f jira-be    # watch boot
```

## Pitfalls

- ❌ Reading 1000 log lines without filter — too noisy. Always `grep -i error` or filter by timestamp.
- ❌ Assuming the error is FE without checking BE logs first. 500 means BE failed.
- ❌ Restarting before reading logs — you lose the smoking gun.
- ❌ Calling `prisma migrate dev` against prod — that's the LOCAL command. Always `migrate deploy` for prod.
