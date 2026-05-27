---
description: Run BE quality gates (typecheck + lint + optional test). Use before commit or before opening a PR.
---

# Quality Gate (BE)

Runs sequentially. Stop at the first failure — don't queue fixes for later.

## Steps

```bash
cd jira-be

# 1. Typecheck — blocks build if fails
npx tsc --noEmit -p tsconfig.json

# 2. Lint — auto-fix where possible
npx eslint "{src,apps,libs,test}/**/*.ts" --fix

# 3. Test (optional — run when changed files have specs)
npm run test:run
```

## What to do on failure

- **Typecheck error in your diff** → fix the type. Don't `as any` to silence.
- **Typecheck error in unrelated file** → probably stale Prisma client. Run `npx prisma generate`.
- **Lint error in your diff** → fix. Don't disable the rule.
- **Lint error in unrelated file** → leave it. Not your PR.
- **Test failure** → if your change broke it, fix the test or the code. If it's a flake, mark + skip in a separate commit with a note.

## When to skip the gate

Almost never. The gate is fast (< 30s typically). Skipping it on "quick fixes" is the #1 way bad code reaches main.

## Pitfalls

- ❌ Running `eslint --fix` on a dirty index then committing without re-reviewing — fixes can be incorrect (e.g. unused-import removal of a dynamically referenced symbol). Always `git diff` before staging.
- ❌ Believing "it works on my machine" means quality. If tsc/eslint scream, CI will too.
