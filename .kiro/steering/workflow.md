---
inclusion: always
---

# Development Workflow — Backend

## Git Branch Naming

```
feat/<short-description>       ← new feature
fix/<short-description>        ← bug fix
refactor/<short-description>   ← code cleanup, no behaviour change
chore/<short-description>      ← tooling, deps, config
docs/<short-description>       ← documentation only
```

Examples: `feat/issue-search-api`, `fix/refresh-token-expiry`, `refactor/remove-dead-dtos`

---

## Commit Message Format (Conventional Commits)

```
<type>(be): <short description>

Types: feat | fix | refactor | chore | docs | test | style
```

Examples:
```
feat(be): add burndown chart endpoint
fix(be): handle expired refresh token edge case
refactor(be): remove unused imports in issues.service
chore(be): upgrade @nestjs/common to 11.0.1
```

---

## Adding a New BE Feature

1. **Prisma schema** (if new model needed) — edit `prisma/*.prisma`, then:
   ```bash
   npx prisma migrate dev --name add_xxx_model
   ```
2. Create `src/modules/xxx/` with `xxx.module.ts`, `xxx.controller.ts`, `xxx.service.ts`, `dto/`
3. Add `@ApiTags`, `@ApiOperation`, `@ApiProperty` decorators throughout
4. Register `XxxModule` in `src/app.module.ts` imports array
5. Add endpoint constants to `src/core/constants/endpoint.constant.ts`
6. Add MSG keys to `src/core/constants/message.constant.ts`
7. Add translations to `jira-fe/src/messages/en.json` and `vi.json` under `"messages"`

---

## Commands to Run Before Every Commit

```bash
npx tsc --noEmit    # must show zero errors
npm run lint        # ESLint --fix (import order + prettier)
npm run build       # dist/ must compile cleanly
```

---

## Prisma Migrations

```bash
# Create and apply a new migration:
npx prisma migrate dev --name <descriptive_name>

# Apply pending migrations in production:
npx prisma migrate deploy

# Reset DB (dev only — destroys all data):
npx prisma migrate reset

# Regenerate client after manual schema edit (no migration):
npx prisma generate

# Open Prisma Studio (DB browser):
npx prisma studio
```

The Prisma config (`prisma.config.ts`) merges all `prisma/*.prisma` files. Never edit a generated `schema.prisma` directly — edit the individual domain files (`issue.prisma`, `board.prisma`, etc.).

---

## Running the App

```bash
npm run start:dev    # dev with watch
npm run build        # production build
npm run start:prod   # run built dist/
```

Swagger UI: `http://localhost:4000/api`
