---
name: bug-fix-flow
description: Repeatable workflow for fixing a BE bug — reproduce, locate, write a minimal fix, verify, commit. Use when a user reports a backend defect.
allowed-tools: Bash, Read, Edit, Grep, Glob
---

# Bug Fix Flow (BE)

A bug is a defect against a known requirement. Don't speculate; verify each step.

## 1. Reproduce

- Get the EXACT request from the reporter: method, URL, body, response status, response body.
- If they have a `RequestLog` row ID: open `/admin/logs` → find it → grab `responseBody` + `errorStack`.
- Try it locally: `curl -i ...` against `localhost:3031`.

If you can't reproduce, stop. Either the bug is environment-specific (prod only — see `.claude/commands/diagnose-prod.md`) or the report is incomplete (ask for more info).

## 2. Locate the failing code path

For a 5xx: `errorStack` in `RequestLog` tells you the file + line.
For a 4xx with wrong validation: search for the DTO + the validator that's failing.
For a logic bug: trace from controller → service → DB call.

Use the `debugger` agent if the trace isn't obvious — `Agent({ subagent_type: "general-purpose", description: "trace bug", prompt: "..." })` with the `debugger` instructions in mind.

## 3. Write a failing test first (when feasible)

If the module has tests, add a unit/integration test that reproduces the bug:
```bash
npm test -- {name}.service.spec.ts
```

If it doesn't have tests, skip — don't pad the PR with infrastructure.

## 4. Minimal fix

- Change the LEAST amount of code that addresses the root cause.
- DON'T refactor surrounding code "while you're here".
- DON'T add defensive `try/catch` around code that doesn't throw.
- DON'T add an abstraction for "future cases".

Common bug archetypes:

| Symptom | Root cause | Fix shape |
|---|---|---|
| 500 on every request to a table | Schema drift — column missing | `migrate deploy` (this isn't a code bug) |
| 500 on edge inputs only | Service doesn't handle `null`/empty array | Add an early return or `?? []` |
| Mutation succeeds but returns stale data | Missing cache invalidation | `void this.cacheTags.invalidateTag(...)` after mutation |
| FE re-renders show old value after PATCH | Service returned stale `select`, not refetched | Return updated row from `update({ data, select: ... })` |
| Concurrent requests double-write | Race between two writes | Wrap in `$transaction` |
| Auth bypass | Service skipped `assertMember`/`assertRole` | Add the assertion |
| Activity feed shows UUID instead of name | New foreign field added to Activity without resolver | Update `findActivity` USER_FIELDS / SPRINT_FIELDS Sets |

## 5. Verify

```bash
npx tsc --noEmit
npm run lint
npm test -- {affected}      # if tests exist
# Manual: re-run the original failing request
```

## 6. Commit

```
fix({scope}): <subject>

Reproduced via: <one-line repro steps>
Root cause: <one line>
Fix: <one line>
```

Don't write multi-paragraph commit bodies. The diff is the proof.

## 7. Deploy

If the bug is on production AND non-trivial: see `.claude/commands/deploy.md`. For straight code fixes (no schema change), skip the migrate step.

## Things to avoid

- ❌ "Fixing" symptoms by adding `try/catch` that swallows the real error.
- ❌ Bundling unrelated refactors with the fix — makes review hard and revert riskier.
- ❌ Marking a bug fixed without re-running the original failing request.
- ❌ Adding a feature flag for the fix — bugs aren't features.
