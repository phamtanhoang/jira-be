---
name: refactor-flow
description: Step-through for a BE refactor that doesn't change behavior — when to split a service, extract a repository, normalize a pattern across modules.
allowed-tools: Bash, Read, Edit, Grep, Glob
---

# Refactor Flow (BE)

A refactor changes structure, NOT behavior. Public-API contracts (HTTP routes, response shapes) MUST stay byte-identical.

## When to refactor

Refactor when ONE of these is true:
- The same pattern is repeated 3+ times AND the next addition will repeat it again.
- A service has exceeded ~500 LOC AND its public methods cluster into 2+ behavioral groups — see `.claude/rules/service-design.md`.
- A subtle bug pattern keeps reappearing because the underlying primitive is wrong.
- Onboarding someone took noticeably longer because of a confusing area.

DON'T refactor "for cleanliness" pre-emptively. 3 similar lines > 1 premature abstraction.

## Plan first

Write a one-page plan in plain text:
- Current shape (file + responsibility list)
- Target shape (same)
- What moves, what's renamed, what gets a new interface
- Tests that pin the existing behavior — without these the refactor is risky

Share the plan in the PR description so reviewers don't have to reconstruct.

## Stage in safe chunks

The PR diff should be one of:
1. **Move-only**: rename + relocate files without changing code. Easy to review.
2. **Extract + delegate**: create new class/function; old code calls it; behavior unchanged.
3. **Inline + remove**: opposite of (2); collapse a pointless wrapper.

If you must change behavior + structure, do them in SEPARATE commits (or PRs). Behavior change reviewed independently of structure change.

## Common refactor shapes

### Service split

Service hit 500 LOC + clusters into CRUD / Search / Activity:

```
src/modules/issues/
├── issues.module.ts
├── issues.controller.ts
├── issues.service.ts                # facade
├── issues.shared.ts                  # selects, includes, type aliases
└── services/
    ├── issues-crud.service.ts
    ├── issues-search.service.ts
    └── issues-activity.service.ts
```

Façade keeps the public surface stable; controllers + external callers don't change.

### Repository extraction

When a service builds dynamic `where`/`orderBy` from filters + the same query is reused across services:

```
src/modules/issues/
├── issues.repository.ts             # data access only — no permission checks
└── issues.service.ts                # permission + business logic
```

See `.claude/rules/service-design.md`. Pilot scope today: Issues, Projects.

### Constants centralization

Three controllers inlining the same magic value → extract:

```ts
// src/core/constants/upload.constant.ts
export const UPLOAD_LIMITS = { ... } as const;
```

Then refactor the three sites in ONE commit. Don't leave one site stale.

### Pattern propagation

After a successful primitive is invented (e.g. `EventLoggerService`), audit other modules for places that should use it but don't. ONE PR per area; don't bundle "convert 8 modules" into a single mega-PR.

## Verification

Refactor PRs are higher risk than feature PRs because:
- No new test coverage typically gets added.
- "It compiles" doesn't mean "it behaves the same."

Required:
```bash
npx tsc --noEmit        # types must still resolve
npm run lint
npm test                # ALL existing tests must pass
# Manual smoke: hit affected endpoints — same response shape, same status codes
```

For touchy refactors: ask `reviewer` agent to compare before/after behavior of one selected endpoint.

## Things to avoid

- ❌ Renaming AND moving AND changing logic in one commit — reviewers can't tell what's structural vs behavioral.
- ❌ Refactoring with no tests pinning behavior — silent regressions.
- ❌ Re-architecting an area no one has complained about.
- ❌ Skipping the `migrate` story — if the refactor touches Prisma schema (column rename), see `.claude/rules/migration-deploy.md` — expand-contract MANDATORY.
- ❌ Bundling refactor with new feature in same PR — the refactor blocks the feature on review.
