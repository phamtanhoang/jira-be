---
inclusion: always
---

# Tech Stack — Backend

## Dependencies (`jira-be/package.json`)

| Package | Version | Role |
|---|---|---|
| `@nestjs/common` | ^11.0.1 | Core NestJS framework |
| `@nestjs/core` | ^11.0.1 | NestJS DI container |
| `@nestjs/jwt` | ^11.0.2 | JWT signing/verification |
| `@nestjs/passport` | ^11.0.5 | Passport integration |
| `@nestjs/swagger` | ^11.2.6 | OpenAPI docs at `/api` |
| `@nestjs/throttler` | ^6.5.0 | Rate limiting |
| `@prisma/client` | ^7.6.0 | Database ORM client |
| `@prisma/adapter-pg` | ^7.6.0 | PostgreSQL adapter for Prisma |
| `prisma` | ^7.6.0 | Schema/migration CLI |
| `@supabase/supabase-js` | ^2.103.0 | File storage (upload/delete) |
| `bcryptjs` | ^3.0.3 | Password hashing (cost factor 12) |
| `class-validator` | ^0.15.1 | DTO validation decorators |
| `class-transformer` | ^0.5.1 | DTO transformation (whitelist) |
| `passport-jwt` | ^4.0.1 | JWT strategy |
| `cookie-parser` | ^1.4.7 | Cookie parsing middleware |
| `helmet` | ^8.1.0 | Security headers |
| `resend` | ^6.10.0 | Transactional email |
| `rxjs` | ^7.8.1 | NestJS reactive streams |
| `typescript` | ^5.7.3 | Language |

---

## ALWAYS / NEVER Rules

**ALWAYS** use `MSG.ERROR.*` and `MSG.SUCCESS.*` constants when throwing exceptions or returning success messages — never hardcode raw strings like `'Not found'`.

**ALWAYS** use `USER_SELECT_BASIC` or `USER_SELECT_FULL` from `prisma-selects.constant.ts` when including user relations in Prisma queries — never select `password` or other sensitive fields.

**ALWAYS** add `@ApiTags('...')` and `@ApiOperation({ summary: '...' })` to every controller and endpoint — Swagger is the primary API documentation.

**ALWAYS** use the `@CurrentUser()` decorator to get the authenticated user in controllers — never read from `req.user` directly.

**ALWAYS** use `@Public()` on any endpoint that must be accessible without a JWT token.

**ALWAYS** throw `NotFoundException`, `ForbiddenException`, or `BadRequestException` with a `MSG.ERROR.*` key — never throw generic `Error`.

**NEVER** use `console.log` or `console.debug` — use `new Logger('ClassName')` from `@nestjs/common`.

**NEVER** put business logic (permission checks, data validation beyond DTO) in controllers — all logic belongs in services.

**NEVER** import from `@prisma/client` in controllers — only in services and type files.

**NEVER** add a new Prisma model without running `npx prisma migrate dev` — the client won't know about it.

**NEVER** change an existing API endpoint URL or response shape without also updating the FE `ENDPOINTS` constant and `api.ts` call.
