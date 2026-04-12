---
paths:
  - "src/modules/**/*"
---

# Module Structure

Each module follows this layout:
```
modules/xxx/
├── xxx.module.ts       # NestJS module definition
├── xxx.controller.ts   # HTTP routes
├── xxx.service.ts      # Business logic
└── dto/
    ├── index.ts        # Barrel export
    ├── create-xxx.dto.ts
    └── update-xxx.dto.ts
```

- ALWAYS import WorkspacesModule when your service needs `assertMember()` access checks
- ALWAYS export your service if other modules depend on it (e.g. WorkspacesService, BoardsService, IssuesService)
- ALWAYS use `@ApiOperation({ summary: '...' })` on every controller method for Swagger docs
- ALWAYS use `@ApiTags('ModuleName')` on the controller class
- PREFER const `E = ENDPOINTS.MODULE_NAME` at top of controller for clean route references
- NEVER import services directly across modules — use module imports/exports
