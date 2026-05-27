---
description: Commit current progress with a Conventional Commits message. Use mid-feature to checkpoint before risky changes.
---

# Checkpoint

A mid-feature commit so you can `git reset` back if the next step breaks. Not for production-ready code — that's a normal commit.

## Steps

```bash
cd jira-be

# 1. Review what's about to be staged
git status --short
git diff --stat

# 2. If quality-gate hasn't passed, run it first
# /quality-gate

# 3. Stage selectively — never `git add -A` for a checkpoint
git add <specific files>

# 4. Commit with Conventional Commits format
git commit -m "<type>(<scope>): <subject>"
```

## Commit type cheatsheet

| Type | Use for |
|---|---|
| `feat` | new endpoint, new module, new capability |
| `fix` | bug fix |
| `refactor` | structural change, no behavior change |
| `perf` | performance optimization |
| `chore` | tooling, deps, build config |
| `docs` | README / CLAUDE.md / inline comments |
| `test` | adding or fixing tests |
| `ci` | GitHub Actions, hooks, scripts |

Scope examples for this repo: `auth`, `issues`, `boards`, `webhooks`, `attachments`, `admin`, `prisma`, `logging`.

## Subject rules

- Imperative present tense: "add" not "added", "adds", "adding"
- Lowercase first letter
- No trailing period
- ≤ 70 chars

Good:
- `feat(issues): add cursor-based pagination to /issues`
- `fix(auth): reject expired OTP with 410 instead of 500`
- `refactor(boards): extract column-reorder into BoardsService`

Bad:
- `Added pagination` — no scope, past tense
- `fix: stuff` — no scope, no information
- `feat(issues): Add pagination for issues so users can scroll long lists.` — past tense, period, too long

## Don't checkpoint

- Secrets / `.env` files — `.gitignore` should catch but double-check `git status`
- Generated files (`node_modules/`, `dist/`, `prisma/generated/`)
- Empty changes ("just to checkpoint") — keep the commit log meaningful

## After multiple checkpoints

When the feature is done, squash:

```bash
git rebase -i HEAD~N
# Mark all but the first as `s` (squash)
```

Or merge with `--squash` so the PR lands as one commit.
