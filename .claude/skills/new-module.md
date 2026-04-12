---
name: new-module
description: Scaffold a new NestJS feature module with controller, service, DTOs, and tests
allowed-tools: Bash, Write, Edit, Read, Grep
---

# Create New Module

## Steps

1. **Create module folder:**
   ```
   src/modules/{name}/
   ├── {name}.module.ts
   ├── {name}.controller.ts
   ├── {name}.service.ts
   └── dto/
       ├── index.ts
       ├── create-{name}.dto.ts
       └── update-{name}.dto.ts
   ```

2. **Module file:** Import WorkspacesModule if access checks needed. Export service if other modules will use it.

3. **Controller:** Use `@ApiTags('{Name}')`, `@ApiOperation()` on each method. Use `const E = ENDPOINTS.{NAME}` for routes.

4. **Service:** Inject PrismaService + WorkspacesService (if needed). Use USER_SELECT_BASIC/FULL for user relations. Wrap multi-step operations in $transaction.

5. **DTOs:** Use class-validator decorators. Add @IsOptional() for update DTOs. Export from dto/index.ts.

6. **Register module** in app.module.ts imports array.

7. **Add endpoints** to core/constants/endpoint.constant.ts.

8. **Add messages** to core/constants/message.constant.ts (both SUCCESS and ERROR).

9. **Run** `npx tsc --noEmit` to verify.
