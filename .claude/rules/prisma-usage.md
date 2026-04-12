---
paths:
  - "src/modules/**/*.service.ts"
---

# Prisma Usage

- ALWAYS use shared select constants from `@/core/constants/prisma-selects.constant.ts`:
  - `USER_SELECT_BASIC` for reporter, assignee, author, user relations
  - `USER_SELECT_FULL` for member lists (includes email)
  - `BOARD_COLUMN_SELECT` for board column relations
- NEVER inline `{ select: { id: true, name: true, image: true } }` — import the constant
- ALWAYS wrap multi-step DB operations in `this.prisma.$transaction(async (tx) => { ... })`
- NEVER use `as any` for Prisma types — use `IssueType`, `IssuePriority`, `Prisma.QueryMode`
- ALWAYS call `workspacesService.assertMember()` before any data operation that requires workspace access
- PREFER `findUnique` over `findFirst` when querying by unique fields (id, key, slug)
