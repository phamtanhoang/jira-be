---
name: investigate-prod
description: Run a triage on a production incident — health → logs → DB → recent deploys. Use when a user reports prod is broken.
allowed-tools: Bash, Read, Grep
---

# Investigate Production Incident (BE)

When prod is broken, follow `.claude/commands/diagnose-prod.md` step-by-step. This skill is the agent-friendly version.

## The 5-minute fast triage

In order:

1. **Health** — `curl -i https://api.jira.3hteam.io.vn/health`. Down → infra/container. Up → app-level.
2. **Container** — `ssh + docker compose ps`. Exited/restarting? See logs.
3. **Logs** — `docker compose logs --since 30m | grep -iE 'error|exception' | tail -100`.
4. **Admin event log** — `/admin/logs` filter `level=ERROR, source=backend, last 30min`. Has full stack + Sentry ID.
5. **Recent deploys** — `git log --oneline -10`. Correlate timestamp.

If any one step yields the answer, stop. Don't continue down the list out of completeness.

## Pattern → diagnosis matrix

| Log line / symptom | Likely cause | Next step |
|---|---|---|
| `column "X" does not exist` | Migration not applied | `.claude/commands/migrate.md` |
| `Can't reach database server` | DB unreachable | Check Neon dashboard / self-host Postgres container |
| `JsonWebTokenError` | JWT_SECRET mismatch | Revert env change; users re-login |
| `ECONNREFUSED 127.0.0.1:5432` | Self-host Postgres down | Restart postgres container |
| Container `Restarting (1)` loop | App crashes at boot | Read first 50 log lines for boot stack |
| 500 on `/complete` (upload) | Supabase storage flaky | Check `/admin/logs` for `error.5xx`; sometimes self-heals |
| 429 on legitimate traffic | Throttle too strict | Bump per-route `@Throttle` |
| Upload 413 | nginx `client_max_body_size` | Adjust nginx OR lower `chunkSize` |
| /admin/logs 500 | Schema drift on RequestLog | `prisma migrate deploy` |
| Slow queries piling up | Compute scaled to zero on Neon | Wait for warm-up (15–30s) or upgrade plan |

## When to escalate

- Multiple unrelated 5xx in same window → likely DB or shared infrastructure.
- 5xx on healthcheck → container is degraded, not the app.
- 5xx that doesn't appear in `/admin/logs` → AllExceptionsFilter is bypassed (raw process crash). Check `docker logs` directly.

## Outputs of this skill

When you finish, report:
- Summary line: `<symptom> caused by <root cause>`.
- Evidence: log line(s), commit SHA, status code.
- Fix: one-line action (`git revert <sha>`, `prisma migrate deploy`, etc.).
- Confidence: high / medium / low.

Don't propose fixes you can't justify with evidence.

## Things to avoid

- ❌ Restarting before reading logs — you lose the smoking gun.
- ❌ "Trying" a fix without identifying the root cause.
- ❌ Reading 1000 log lines unfiltered.
- ❌ `prisma migrate dev` against prod — that's the LOCAL command. Use `migrate deploy`.
