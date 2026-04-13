# Design: BE Refactor & Code Cleanup

## Tech Stack
- NestJS + TypeScript
- Prisma ORM + PostgreSQL
- JWT Auth (access + refresh tokens)
- class-validator + class-transformer
- Swagger / OpenAPI

## Approach
Two-phase: audit first (report only), execute second (after approval).
No business logic or API contracts may change.

---

## Phase 1 — Audit

### Scan targets
```
be/src/                        ← all modules
be/src/common/                 ← shared utilities, guards, decorators
be/src/*/dto/                  ← DTOs per module
be/src/*/entities/ or models/  ← entity files if any outside Prisma
```

### Detection methods
| Category | Method |
|---|---|
| Unused imports | ESLint: unused-imports/no-unused-imports + tsc |
| Dead modules | Module not in any other module's imports[] |
| Dead services | Service not injected in any constructor |
| Dead DTOs | DTO class not referenced in any controller/service |
| Dead helpers | Function not called anywhere in be/src/ |
| Console statements | Regex: console\.(log|debug|warn) — NOT console.error |
| Commented-out blocks | Regex: 3+ consecutive // lines or /* */ blocks |

### Special NestJS checks
- Providers declared in a module but never injected anywhere
- @Injectable() classes with no consumers
- Guards or interceptors registered globally but doing nothing
- Swagger @ApiProperty decorators on fields that no longer exist

### Audit report format
```
CATEGORY       | FILE                                    | LINE | ACTION
---------------|-----------------------------------------|------|--------
Unused import  | src/issue/issue.service.ts               | 5    | REMOVE
Dead DTO       | src/auth/dto/old-token.dto.ts            | -    | DELETE
Console.log    | src/workspace/workspace.service.ts       | 82   | REMOVE
Dead provider  | src/notification/notification.module.ts  | 12   | REVIEW
```

---

## Phase 2 — Execute (after approval only)

### Order of operations (lowest → highest risk)
1. Remove console.log / console.debug
2. Fix unused imports
3. Remove commented-out code blocks
4. Delete dead DTOs
5. Delete dead utility helpers
6. Delete dead services (with careful review)
7. Delete dead modules (highest risk — review each one)

### Commit strategy (one commit per step)
```
refactor(be): remove console statements
refactor(be): remove unused imports
refactor(be): remove commented-out code
refactor(be): remove dead DTOs
refactor(be): remove dead helpers
refactor(be): remove dead services and modules
```

### Verification after each step
- npx tsc --noEmit            → zero TypeScript errors
- npm run build               → dist/ compiles successfully
- npm run start:dev           → server starts, no injection errors
- curl key endpoints          → 200 responses on main routes