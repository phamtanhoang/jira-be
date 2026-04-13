---
inclusion: fileMatch
globs: ["jira-be/src/**/*.ts"]
---

# Backend Conventions

## Module Structure

Every feature module follows this layout:

```
src/modules/xxx/
  xxx.module.ts       ← @Module({ imports, controllers, providers, exports })
  xxx.controller.ts   ← HTTP layer only — no business logic
  xxx.service.ts      ← All business logic, Prisma calls
  dto/
    create-xxx.dto.ts
    update-xxx.dto.ts
    index.ts          ← re-exports all DTOs
```

Module template:
```ts
@Module({
  imports: [WorkspacesModule],   // only if service needs WorkspacesService
  controllers: [XxxController],
  providers: [XxxService],
  exports: [XxxService],         // only if other modules need it
})
export class XxxModule {}
```

Register in `src/app.module.ts` imports array.

---

## DTO Naming & Validation

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsEnum, MaxLength } from 'class-validator';

export class CreateXxxDto {
  @ApiProperty({ example: 'My Name' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ example: 'Optional desc' })
  @IsString()
  @IsOptional()
  description?: string;
}
```

Rules:
- Required fields: `@ApiProperty` + `@IsNotEmpty()` + `!` assertion
- Optional fields: `@ApiPropertyOptional` + `@IsOptional()` + `?` type
- Enums: `@IsEnum(EnumName)` + `@ApiProperty({ enum: EnumName })`
- Strings with length: `@MaxLength(N)` from class-validator
- Passwords/emails: use `@Matches(REGEX.PASSWORD)` / `@Matches(REGEX.EMAIL)` from `@/core/constants`
- `ValidationPipe` is global with `whitelist: true, forbidNonWhitelisted: true, transform: true`

---

## Guard & Auth Decorator Patterns

```ts
// Make an endpoint public (no JWT required):
@Public()
@Post('register')
register(@Body() dto: RegisterDto) { ... }

// Get the authenticated user:
@Get('me')
getMe(@CurrentUser() user: AuthUser) { ... }

// Restrict to platform ADMIN role (rare — most auth is service-level):
@Roles(Role.ADMIN)
@Get('admin-only')
adminOnly() { ... }
```

Business-level permission checks (workspace/project roles) are done in services:
```ts
// In service — check workspace membership:
await this.assertMember(workspaceId, userId);

// Check workspace role (OWNER or ADMIN):
await this.assertRole(workspaceId, userId, [WorkspaceRole.OWNER, WorkspaceRole.ADMIN]);
```

---

## Error Throwing Conventions

| Situation | Exception |
|---|---|
| Resource not found | `throw new NotFoundException(MSG.ERROR.X_NOT_FOUND)` |
| Not a member / no permission | `throw new ForbiddenException(MSG.ERROR.INSUFFICIENT_PERMISSIONS)` |
| Duplicate / already exists | `throw new BadRequestException(MSG.ERROR.X_ALREADY_EXISTS)` |
| Invalid token / credentials | `throw new UnauthorizedException(MSG.ERROR.X)` |

Always use `MSG.ERROR.*` constants — never raw strings. The FE translates these keys.

---

## Prisma Usage Patterns

```ts
// Inject in constructor:
constructor(private prisma: PrismaService) {}

// Always use shared selects for user fields:
import { USER_SELECT_BASIC, USER_SELECT_FULL } from '@/core/constants';

// Example — include user with basic fields:
this.prisma.issue.findMany({
  include: {
    assignee: USER_SELECT_BASIC,
    reporter: USER_SELECT_BASIC,
  },
});

// Shared selects available:
// USER_SELECT_BASIC  → { select: { id, name, image } }
// USER_SELECT_FULL   → { select: { id, name, email, image } }
// BOARD_COLUMN_SELECT → { select: { id, name, category } }

// Transactions for multi-step writes:
await this.prisma.$transaction([
  this.prisma.xxx.update(...),
  this.prisma.yyy.create(...),
]);
```

Prisma schema is split across multiple `.prisma` files in `prisma/` and merged via `prisma.config.ts`. Run `npx prisma migrate dev --name <name>` to create migrations.

---

## API Response Shape

Controllers return plain objects — NestJS serialises them to JSON:

```ts
// Mutation with entity:
return { message: MSG.SUCCESS.ISSUE_CREATED, issue };

// Mutation without entity:
return { message: MSG.SUCCESS.ISSUE_DELETED };

// Query (direct return from service):
return this.xxxService.findAll(...);

// Bulk result:
return { message: MSG.SUCCESS.ISSUE_UPDATED, count: result.count };
```

Error responses (from `AllExceptionsFilter`):
```json
{
  "statusCode": 404,
  "message": "ISSUE_NOT_FOUND",
  "timestamp": "2026-04-13T10:00:00.000+07:00"
}
```

---

## MSG.ERROR.* Constants Pattern

All error and success message keys live in `src/core/constants/message.constant.ts`:

```ts
MSG.ERROR.ISSUE_NOT_FOUND        // → 'ISSUE_NOT_FOUND'
MSG.SUCCESS.ISSUE_CREATED        // → 'ISSUE_CREATED'
```

When adding a new error:
1. Add to `MSG.ERROR` in `message.constant.ts`
2. Add translation to `jira-fe/src/messages/en.json` under `"messages"` key
3. Add translation to `jira-fe/src/messages/vi.json` under `"messages"` key

---

## Swagger Decorators

Every controller must have:
```ts
@ApiTags('ResourceName')   // on the class
@ApiOperation({ summary: 'One-line description' })  // on each method
```

DTOs must use `@ApiProperty` / `@ApiPropertyOptional` on every field.
Swagger UI is available at `http://localhost:4000/api`.
