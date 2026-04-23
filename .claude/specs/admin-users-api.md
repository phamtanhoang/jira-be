# API: Admin Users + System Stats

## Status: done

## Problem
The FE admin area (see [../../../jira-fe/.claude/specs/admin-enhancements.md](../../../jira-fe/.claude/specs/admin-enhancements.md)) needs:
1. User listing + role management — no `users` module exists yet. Role is stored on `User.role` but never exposed via HTTP.
2. Aggregate counts (users, workspaces, projects, issues, logs by level) — requires a single round-trip to avoid N queries from the FE overview page.

## Module: `UsersModule` (new)
File layout:
```
src/modules/users/
├── users.module.ts
├── users.controller.ts      # @Roles(Role.ADMIN) on ALL routes
├── users.service.ts
└── dto/
    ├── index.ts
    ├── query-users.dto.ts   # search, role, emailVerified, cursor, take
    └── update-role.dto.ts   # { role: Role }
```

Base path: `users`. Register in `app.module.ts` alongside other modules.

### Endpoints
| Method | Path              | Body                 | Purpose |
| ------ | ----------------- | -------------------- | ------- |
| GET    | `/users`          | —                    | Paginated list with filters |
| PATCH  | `/users/:id/role` | `{ role: "USER" \| "ADMIN" }` | Update role |
| DELETE | `/users/:id`      | —                    | Delete user (cascade via FKs) |

### Guard rails
- **Self-protection** — `PATCH /users/:id/role` throws `ForbiddenException(MSG.ERROR.CANNOT_MODIFY_SELF)` when `id === currentUser.id`. Same for `DELETE`. Rationale: prevents an admin from locking themselves out by demoting/deleting their own account.
- **Workspace owner** — deleting a user who owns workspaces will cascade-delete those workspaces (Prisma `onDelete: Cascade`). No special handling — BE throws the cascade happens and admin sees result. Spec does NOT add an ownership-transfer flow; that's future work.
- Role enum: validated via `class-validator` `@IsEnum(Role)` from `@prisma/client`.

### Response format
- List: `{ data: User[], nextCursor: string | null, hasMore: boolean }` — user shape = `id, name, email, emailVerified, image, role, createdAt, updatedAt, _count: { ownedWorkspaces, assignedIssues, comments }`.
- Update: `{ message: MSG.SUCCESS.USER_ROLE_UPDATED, user }`.
- Delete: `{ message: MSG.SUCCESS.USER_DELETED }`.

### Prisma selects
Add to `prisma-selects.constant.ts`:
```ts
export const USER_SELECT_ADMIN = {
  select: {
    id: true, name: true, email: true, emailVerified: true, image: true,
    role: true, createdAt: true, updatedAt: true,
    _count: { select: { ownedWorkspaces: true, assignedIssues: true, comments: true } },
  },
} as const;
```

### New `MSG` entries
- `SUCCESS.USER_ROLE_UPDATED = 'USER_ROLE_UPDATED'`
- `SUCCESS.USER_DELETED = 'USER_DELETED'`
- `ERROR.CANNOT_MODIFY_SELF = 'CANNOT_MODIFY_SELF'`

### New `ENDPOINTS.USERS`
```ts
USERS: {
  BASE: 'users',
  BY_ID: ':id',
  ROLE: ':id/role',
}
```

## System Stats Endpoint (new — lives in existing module)

Add to `LogsModule` OR create a tiny new route under `UsersController`. Decision: put it on **`GET /admin/stats`** via a new `AdminController` so future admin-wide aggregates have a home. Keep it minimal to avoid yet another module — place `AdminController` inside `UsersModule` and export nothing (admin-module overlap is fine since both are `@Roles(Role.ADMIN)`).

### Endpoint: `GET /admin/stats`
Response:
```ts
{
  users: { total: number; admins: number; newLast7Days: number; unverified: number };
  workspaces: { total: number };
  projects: { total: number };
  issues: { total: number };
  logs: { last24h: { INFO: number; WARN: number; ERROR: number } };
}
```
Implementation: single `$transaction` with `prisma.user.count` × 4 (filtered), `workspace.count`, `project.count`, `issue.count`, `requestLog.groupBy({ by: ['level'], where: { createdAt: { gte: 24h ago } } })`. All counts wrapped in one round-trip.

### Endpoint: `ENDPOINTS.ADMIN`
```ts
ADMIN: {
  BASE: 'admin',
  STATS: 'stats',
}
```

## Tests (unit)
- `test/unit/modules/users/dto/query-users.dto.spec.ts` — validation
- `test/unit/modules/users/dto/update-role.dto.spec.ts` — rejects invalid role values
- Service-level tests: deferred (service depends on Prisma; existing convention does not mock Prisma in unit tests)

## Security
- All new endpoints `@Roles(Role.ADMIN)` — enforced by global `RolesGuard`.
- `DELETE /users/:id` is destructive — cascades remove owned workspaces + their projects + issues. No soft-delete for now.
- Rate limits: inherits global `ThrottlerModule` default (10/min). No stricter per-route throttle needed — admin-only.

## Non-goals
- Workspace ownership transfer before user delete (future).
- Soft-delete / account suspension.
- Bulk user ops (import, bulk role change).
- Audit log of admin actions (the existing `RequestLog` already captures PATCH/DELETE with user context).
