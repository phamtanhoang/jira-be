---
inclusion: always
---

# Project: Jira Clone — Backend

Full-stack Jira-like project management tool. This folder (`jira-be/`) is the NestJS REST API running on port 4000.

```
jira-be/   ← this app (NestJS, port 4000)
jira-fe/   ← Next.js frontend (port 3000) — separate folder
```

---

## FE ↔ BE Communication

- FE proxies all `/api/*` requests to `http://localhost:4000/*` via Next.js rewrites
- Auth: `access_token` cookie (httpOnly, JWT) + `refresh_token` cookie (httpOnly, path=/)
- Every request includes `x-timezone` header (IANA string) — BE formats all Date fields in responses using it
- FE also sends a non-httpOnly `is_authenticated=1` cookie for client-side 401 detection

---

## Required Environment Variables (`jira-be/.env`)

| Variable | Example | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://...` | Neon PostgreSQL connection string |
| `PORT` | `4000` | HTTP server port |
| `JWT_SECRET` | `<secret>` | JWT signing secret |
| `TOKEN_VERIFY_EXPIRY` | `900` | OTP expiry in seconds (15 min) |
| `JWT_ACCESS_TOKEN_EXPIRATION` | `900` | Access token TTL in seconds |
| `JWT_REFRESH_TOKEN_EXPIRATION` | `604800` | Refresh token TTL in seconds (7 days) |
| `CORS_ORIGIN` | `http://localhost:3000` | Comma-separated allowed origins |
| `NODE_ENV` | `development` | Affects cookie `secure` flag |
| `RESEND_API_KEY` | `re_...` | Resend email API key |
| `SUPABASE_URL` | `https://xxx.supabase.co` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | `eyJ...` | Supabase service role key |
| `SUPABASE_STORAGE_BUCKET` | `jira-storage` | Supabase storage bucket name |

---

## Role & Permission System

### Global user role (`User.role`)
| Role | Description |
|---|---|
| `USER` | Default for all registered users |
| `ADMIN` | Platform-level admin (currently unused in controllers) |

### Workspace roles (`WorkspaceMember.role`)
| Role | Permissions |
|---|---|
| `OWNER` | Everything including delete workspace; cannot be removed |
| `ADMIN` | Add/remove/update members, update workspace |
| `MEMBER` | Read access, create issues |
| `VIEWER` | Read-only |

### Project roles (`ProjectMember.role`)
| Role | Description |
|---|---|
| `LEAD` | Project lead |
| `ADMIN` | Admin |
| `DEVELOPER` | Developer |
| `VIEWER` | Read-only |

### How enforcement works
- `JwtAuthGuard` is global (`APP_GUARD`) — all routes require JWT by default
- `@Public()` bypasses JWT check — required on all auth endpoints
- `RolesGuard` is global — checks `@Roles(Role.ADMIN)` against `user.role`
- Workspace/project role checks are done in services via `assertMember()` / `assertRole()` — NOT via `RolesGuard`
- `ThrottlerGuard` is global — default 10 req/60s; auth endpoints override to 5 or 3 req/60s

---

## Top 5 Things Easiest to Get Wrong

1. **Forgetting `@Public()` on new auth endpoints** — `JwtAuthGuard` is global, so any new endpoint without `@Public()` returns 401 even for login/register.

2. **Using `console.log` instead of NestJS `Logger`** — bypasses NestJS logging context. Use `new Logger('ClassName')` and `logger.log()` / `logger.error()`.

3. **Not using `x-timezone` header awareness** — The `TimezoneInterceptor` transforms all Date fields in responses. If you return raw ISO strings instead of `Date` objects from Prisma, they won't be transformed.

4. **Returning raw Prisma objects with sensitive fields** — Always use `USER_SELECT_BASIC` or `USER_SELECT_FULL` for user relations. Never let `password` or `emailVerified` leak into responses.

5. **Mismatching MSG keys with FE** — BE returns string keys like `'ISSUE_CREATED'`. FE translates them via `messages.ISSUE_CREATED` in `en.json`/`vi.json`. Adding a new key in BE without updating both JSON files causes the raw key to show in toasts.
