---
description: Scan .claude/ + CLAUDE.md for accidentally-committed secrets, then sanity-check .env handling.
---

# Security Scan (BE)

Quick local scan for the most common secret-leak patterns in this repo.

## What to scan

```bash
cd jira-be

# 1. Find raw secrets in committed files
grep -rEn "(eyJ[a-zA-Z0-9_-]{20,}|sk-[a-zA-Z0-9]{20,}|sntrys_[a-zA-Z0-9_]+|re_[a-zA-Z0-9]{30,}|postgres(?:ql)?://[^/]*:[^@\s]+@)" \
  .claude/ CLAUDE.md docker-compose.yml 2>/dev/null

# 2. Confirm .env isn't tracked
git ls-files | grep -E "^\.env" || echo "✅ .env not tracked"

# 3. Confirm .env in .gitignore
grep -E "^\.env" .gitignore || echo "❌ .env not gitignored — add it now"

# 4. Inspect Docker compose for hardcoded passwords
grep -nE "(PASSWORD|SECRET|TOKEN|KEY)\s*[:=]\s*['\"]?[A-Za-z0-9_-]{8,}" docker-compose.yml 2>/dev/null
```

## What to look for

| Pattern | Indicates | Action |
|---|---|---|
| `eyJ...` | JWT token | Rotate, never commit |
| `sk-...` | OpenAI/Anthropic key | Rotate immediately |
| `sntrys_...` | Sentry auth token | Rotate via Sentry UI |
| `re_...` | Resend API key | Rotate via Resend UI |
| `postgres://user:pwd@...` | DB credentials in URL | Rotate DB password |
| Hardcoded password in docker-compose | Local-only? Move to `.env` |

## If you find a leak

1. **Don't just `git commit` a fix** — the secret is still in history. Rotate the credential at the source first.
2. Remove the secret from current files.
3. Rewrite history with BFG or `git filter-repo`:
   ```bash
   git filter-repo --replace-text expressions.txt
   ```
4. Force-push (with team buy-in — see `.claude/RULES_INDEX.md` for the deploy/restore protocol).

## What this scan does NOT cover

- Secrets in runtime memory / heap dumps
- Secrets in logs (use `.claude/rules/logging.md` SENSITIVE_KEYS)
- Secrets in third-party packages (use `npm audit` or AgentShield)

For deeper auditing: `npx ecc-agentshield scan` from the ECC plugin.

## Things to avoid

- ❌ Committing `.env*` even temporarily "for testing"
- ❌ Putting secrets in CLAUDE.local.md and then committing it by accident — verify it's gitignored
- ❌ Sharing `JWT_SECRET` via Slack or docs — use a password manager
- ❌ Treating `NEXT_PUBLIC_*` as private — those go in the browser bundle, visible to everyone
