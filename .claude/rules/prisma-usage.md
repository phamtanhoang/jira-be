---
paths:
  - "src/modules/**/*.service.ts"
---

# Prisma Usage

## Select constants
- ALWAYS use shared select constants from `@/core/constants/prisma-selects.constant.ts`:
  - `USER_SELECT_BASIC` for reporter, assignee, author, user relations
  - `USER_SELECT_FULL` for member lists (includes email)
  - `BOARD_COLUMN_SELECT` for board column relations
- NEVER inline `{ select: { id: true, name: true, image: true } }` — import the constant.

## Transactions
- ALWAYS wrap multi-step DB operations in `this.prisma.$transaction(async (tx) => { ... })`.
- For paginated list endpoints that return a total count, use `$transaction([findMany, count])` so the two reads see the same snapshot. Canonical pattern in `logs.service.ts::findAll` and `admin-audit.service.ts::findAll`.

## Existence checks
- Use `assertExists(value, MSG.ERROR.X)` from `@/core/utils/assert-exists.util.ts` instead of the 3-line `findUnique + null-check + throw` dance. Collapses the typical pattern into one expression.

## Types
- NEVER use `as any` for Prisma types — use `IssueType`, `IssuePriority`, `Prisma.QueryMode`, etc.

## Access control
- ALWAYS call `workspacesService.assertMember()` before any data operation that requires workspace access. Service-layer enforcement is the source of truth; controllers must not skip this.

## Query performance
- PREFER `findUnique` over `findFirst` when querying by unique fields (id, key, slug).
- Parallelise independent `findMany` / `count` calls with `Promise.all([...])` — don't `await` them sequentially.
- BEFORE shipping a new filter / orderBy, check that a matching `@@index(...)` exists on the model. Add one in the `.prisma` file if missing. Compound indexes beat multiple single-column ones for `where X orderBy Y` patterns — example: `Activity` has `@@index([issueId, createdAt])` for the feed query.
