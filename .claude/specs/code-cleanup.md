# Feature: Code Cleanup — Type Safety, Transactions, Shared Constants

## Status: done

## Context
Codebase had `as any` casts, missing transactions, duplicated Prisma selects, and inconsistent error handling.

## Changes Made
- [x] Removed 6 `as any` casts in issues.service.ts — replaced with IssueType, IssuePriority, Prisma.QueryMode
- [x] Fixed auth controller refresh endpoint — throw UnauthorizedException instead of res.status().json()
- [x] Wrapped issue creation in $transaction (counter increment + create + activity log)
- [x] Extracted shared Prisma selects to core/constants/prisma-selects.constant.ts (USER_SELECT_BASIC, USER_SELECT_FULL, BOARD_COLUMN_SELECT)
- [x] Replaced duplicated inline selects across issues, comments, worklogs, projects services
- [x] Added ACTIVITY_LIMIT constant for magic number
- [x] Added JSDoc comment to timezone utility explaining Intl.DateTimeFormat approach

## Files Affected
- `src/modules/issues/issues.service.ts`
- `src/modules/auth/auth.controller.ts`
- `src/modules/comments/comments.service.ts`
- `src/modules/worklogs/worklogs.service.ts`
- `src/modules/projects/projects.service.ts`
- `src/core/constants/prisma-selects.constant.ts` — new
- `src/core/utils/timezone.util.ts`
