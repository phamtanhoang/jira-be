# Requirements: BE Refactor & Code Cleanup

## Overview
Clean up the backend (NestJS) codebase by removing dead code, unused
imports, unreferenced modules/services/DTOs, and console statements —
without changing any API contracts or business logic.

## Scope
- be/src/**/*.ts
- Exclude: **/*.spec.ts, **/*.test.ts, **/node_modules/**, **/dist/**

---

## User Stories

### 1. Remove unused imports
As a developer,
I want all unused imports removed from every BE file,
so that the codebase is clean and tsc compiles without warnings.

Acceptance Criteria:
- GIVEN any .ts file in be/src/
- WHEN the file is opened
- THEN no TypeScript or ESLint unused-import warnings exist

### 2. Remove dead modules and services
As a developer,
I want NestJS modules and services that are never injected or
imported anywhere to be deleted.

Acceptance Criteria:
- GIVEN a module file in be/src/
- WHEN it is not imported in any other module's imports[] array
- THEN the module and its associated service/controller/dto folder
  are deleted
- AND the app compiles and all endpoints still respond correctly

### 3. Remove dead DTOs
As a developer,
I want DTO classes that are never used in any controller or service
to be deleted.

Acceptance Criteria:
- GIVEN a DTO file in be/src/
- WHEN it is not referenced in any controller, service, or other DTO
- THEN the file is deleted
- AND no compile error occurs

### 4. Remove dead utility functions and helpers
As a developer,
I want helper functions in be/src/common/ or be/src/utils/ that are
never called to be removed.

Acceptance Criteria:
- GIVEN a utility function
- WHEN it has zero call sites in be/src/
- THEN it is removed
- AND its file is deleted if it becomes empty

### 5. Remove console statements
As a developer,
I want console.log / console.debug removed from production BE code,
so that logs are clean and structured (only NestJS Logger remains).

Acceptance Criteria:
- GIVEN any .ts file in be/src/
- WHEN scanned
- THEN no console.log or console.debug remain
- EXCEPT console.error inside the global exception filter (keep)
- AND NestJS Logger calls (this.logger.*) are preserved

### 6. Remove commented-out code
As a developer,
I want commented-out code blocks (3+ consecutive lines) removed.

Acceptance Criteria:
- GIVEN any file containing a commented-out block of 3 or more lines
- WHEN cleanup runs
- THEN the block is removed
- AND single-line explanatory comments are preserved

## Constraints
- No API endpoint URLs may change
- No request/response shapes may change
- No Prisma schema changes
- All existing API tests must pass after cleanup