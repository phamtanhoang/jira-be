# Tasks: BE Refactor & Code Cleanup

## Phase 1 — Audit (no changes, report only)

- [ ] 1. Run ESLint unused-imports scan across be/src/ and save report
- [ ] 2. List all NestJS modules in be/src/ not imported in any other module
- [ ] 3. List all @Injectable() services never injected in any constructor
- [ ] 4. List all DTO files in be/src/*/dto/ not referenced in any controller or service
- [ ] 5. Find all functions in be/src/common/ and be/src/utils/ with zero call sites
- [ ] 6. Find all console.log / console.debug in be/src/ (exclude console.error)
- [ ] 7. Find all commented-out code blocks (3+ consecutive comment lines)
- [ ] 8. Check for @ApiProperty decorators on non-existent fields
- [ ] 9. Check for providers declared in module but never injected
- [ ] 10. Compile full audit report grouped by category with file paths and line numbers
- [ ] 11. Present audit report — STOP and wait for approval before Phase 2

## Phase 2 — Execute (only after Phase 1 approved)

- [x] 12. Remove all console.log and console.debug from be/src/
- [ ] 13. Verify: npm run start:dev starts without errors
- [ ] 14. Commit: "refactor(be): remove console statements"

- [x] 15. Run ESLint --fix for unused imports across be/src/
- [x] 16. Manually remove unused imports ESLint could not auto-fix
- [ ] 17. Verify: npx tsc --noEmit passes
- [ ] 18. Commit: "refactor(be): remove unused imports"

- [ ] 19. Remove commented-out code blocks (3+ lines)
- [ ] 20. Commit: "refactor(be): remove commented-out code"

- [ ] 21. Delete confirmed dead DTO files from be/src/*/dto/
- [ ] 22. Verify: npx tsc --noEmit passes
- [ ] 23. Commit: "refactor(be): remove dead DTOs"

- [ ] 24. Remove dead utility functions from be/src/common/ and be/src/utils/
- [ ] 25. Delete files that become empty after removal
- [ ] 26. Commit: "refactor(be): remove dead helpers"

- [ ] 27. Delete confirmed dead services (review each carefully first)
- [ ] 28. Delete confirmed dead modules (review each carefully first)
- [ ] 29. Verify: npm run build succeeds and dist/ is clean
- [ ] 30. Commit: "refactor(be): remove dead services and modules"

## Phase 3 — Verify

- [ ] 31. Run: npx tsc --noEmit → must show zero errors
- [ ] 32. Run: npm run build → must succeed
- [ ] 33. Run: npm run start:dev → server must start with no injection errors
- [ ] 34. Test key endpoints manually or via Swagger UI:
          GET  /workspaces
          GET  /projects/:id/board
          POST /issues
          POST /auth/login
- [ ] 35. Confirm all Prisma queries still work — no missing model references