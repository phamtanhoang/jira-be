---
paths:
  - "src/modules/**/controllers/*.ts"
  - "src/modules/**/*.controller.ts"
---

# Response Format

- ALWAYS return `{ message: MSG.SUCCESS.X, ...data }` from controllers
- ALWAYS use message constants from `@/core/constants` (MSG.SUCCESS.*, MSG.ERROR.*)
- NEVER return raw data without a message wrapper
- NEVER construct manual responses with `res.status().json()` — throw NestJS exceptions instead
- PREFER NotFoundException for missing resources, BadRequestException for validation, ForbiddenException for auth
