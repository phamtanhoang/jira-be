---
name: new-module
description: Scaffold a new NestJS feature module with controller, service, DTOs, and module wiring. Use when adding a new domain area.
allowed-tools: Bash, Write, Edit, Read, Grep
---

# Create New Module

A complete domain area: controller + service + DTOs + module registration. Follow this skeleton; don't omit steps.

## 1. Folder structure

```
src/modules/{name}/
├── {name}.module.ts
├── {name}.controller.ts
├── {name}.service.ts                # OR services/ folder if > 500 LOC anticipated
├── dto/
│   ├── index.ts                     # barrel
│   ├── create-{name}.dto.ts
│   ├── update-{name}.dto.ts
│   └── {name}-query.dto.ts          # list filters / cursor
└── exceptions/                      # only if domain-specific exception classes exist
    └── {name}-not-found.exception.ts
```

## 2. Module file

```ts
// src/modules/{name}/{name}.module.ts
import { Module } from '@nestjs/common';
import { {Name}Controller } from './{name}.controller';
import { {Name}Service } from './{name}.service';
import { WorkspacesModule } from '../workspaces/workspaces.module';

@Module({
  imports: [WorkspacesModule],   // for membership checks
  controllers: [{Name}Controller],
  providers: [{Name}Service],
  exports: [{Name}Service],       // ONLY if another module injects it
})
export class {Name}Module {}
```

## 3. Controller

```ts
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ENDPOINTS, MSG } from '@/core/constants';
import { CurrentUser } from '@/core/decorators';
import { AuthUser } from '@/core/types';

const E = ENDPOINTS.{NAME};

@ApiTags('{Name}')
@ApiBearerAuth()
@Controller(E.BASE)
export class {Name}Controller {
  constructor(private readonly service: {Name}Service) {}

  @ApiOperation({ summary: 'Create {name}' })
  @Post()
  async create(@Body() dto: Create{Name}Dto, @CurrentUser() user: AuthUser) {
    const item = await this.service.create(dto, user.id);
    return { message: MSG.SUCCESS.{NAME}_CREATED, item };
  }
}
```

**Rules:**
- Response shape ALWAYS `{ message: MSG.SUCCESS.X, ...data }`. NEVER raw data, NEVER `res.json()`.
- Use `@Throttle()` per `.claude/rules/throttle.md` for write endpoints.
- `@Roles(Role.ADMIN)` for admin-only endpoints — see `.claude/rules/logging.md` for log endpoints.

## 4. Service

```ts
@Injectable()
export class {Name}Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly events: EventLoggerService,       // if any domain events
    private readonly audit: AdminAuditService,         // if admin-visible destructive ops
    private readonly cacheTags: CacheTagsService,       // if cached
  ) {}

  async create(dto: Create{Name}Dto, userId: string) {
    await this.workspaces.assertMember(dto.workspaceId, userId);

    return this.prisma.$transaction(async (tx) => {
      const item = await tx.{name}.create({
        data: { ...dto, createdBy: userId },
        select: USER_SELECT_BASIC,    // or appropriate select constant
      });
      // related writes
      return item;
    });
  }
}
```

**Rules:**
- ALWAYS use selects from `core/constants/prisma-selects.constant.ts` — NEVER inline `{id: true, name: true}`.
- Multi-step DB writes MUST be in `$transaction`.
- See `.claude/rules/service-design.md` for split-into-sub-services heuristic (~500 LOC).
- If using caching: see `.claude/rules/cache.md` for `wrap` + tag invalidation pattern.
- Throw `BaseAppException` subclasses for stable error codes the FE branches on — see `.claude/rules/exceptions.md`.

## 5. DTOs

```ts
// dto/create-{name}.dto.ts
import { IsString, IsUUID, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class Create{Name}Dto {
  @ApiProperty({ example: 'My item' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiProperty()
  @IsUUID()
  workspaceId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;
}
```

**Rules:**
- Both `class-validator` AND `@ApiProperty()` — Swagger drives the FE OpenAPI generator.
- Sensitive fields (passwords, OTPs) added → also add to `SENSITIVE_KEYS` in `core/utils/sanitize.util.ts` per `.claude/rules/logging.md`.
- Re-export from `dto/index.ts` barrel.

## 6. Register module

Add to `src/app.module.ts` imports array:

```ts
@Module({
  imports: [
    // ...existing
    {Name}Module,
  ],
})
```

## 7. Add to shared constants

- `src/core/constants/endpoint.constant.ts` — add `ENDPOINTS.{NAME}` with `BASE`, `BY_ID`, etc.
- `src/core/constants/message.constant.ts` — add `MSG.SUCCESS.{NAME}_*` + `MSG.ERROR.{NAME}_*`.

## 8. Audit / log / cache hooks (if applicable)

- **Audit**: see `.claude/rules/audit-log.md`. Call `this.audit.log(actorId, 'X', payload)` for destructive admin actions.
- **Event log**: see `.claude/rules/event-logging.md`. Emit via `EventLoggerService` for meaningful state changes (NOT every request).
- **Webhook**: see `.claude/rules/webhook-events.md`. Dispatch coarse events; never per-field updates.
- **Cache**: see `.claude/rules/cache.md`. Wrap hot reads + invalidate on mutation.

## 9. Verify

```bash
npx tsc --noEmit             # types
npm run lint                 # lint
# Hit Swagger UI at http://localhost:3031/api → /{name} group visible
```

## 10. FE pairing

If FE consumes this module:
- Regenerate OpenAPI types: `cd jira-fe && npm run openapi:gen` (see `jira-fe/.claude/commands/openapi-sync.md`).
- Add API wrapper in `src/features/{name}/api.ts` and hooks in `hooks.ts`.

## Things easy to get wrong

- ❌ Skipping the `assertMember` / `assertRole` call — service must enforce permission, NOT just the controller decorator.
- ❌ Inline Prisma selects — kills DRY. Use the constants.
- ❌ Adding sensitive DTO field without updating `SENSITIVE_KEYS` → plaintext in `RequestLog`.
- ❌ Forgetting to add the module to `app.module.ts` imports → controller route never registered.
- ❌ Naming endpoints inconsistent with `ENDPOINTS.{NAME}` — drift between controller and constants.
