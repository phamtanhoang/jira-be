---
paths:
  - "src/modules/**/controllers/*.ts"
  - "src/modules/**/*.controller.ts"
---

# Response Format

## Shape
- ALWAYS return `{ message: MSG.SUCCESS.X, ...data }` from controllers.
- ALWAYS use message constants from `@/core/constants` (`MSG.SUCCESS.*`, `MSG.ERROR.*`).
- NEVER return raw data without a message wrapper.
- NEVER construct manual responses with `res.status().json()` — throw NestJS exceptions instead.
- PREFER `NotFoundException` for missing resources, `BadRequestException` for validation, `ForbiddenException` for auth.

## Pagination
- Page-based (admin lists): response is `{ data, total, page, pageSize, totalPages, hasMore }`. Service uses `$transaction([count, findMany])`.
- Cursor-based (infinite scroll): response is `{ data, nextCursor, hasMore }`. Use for `issues-infinite` and similar high-volume feeds.
- Pick page-based when the UI shows numbered pages, cursor-based when it's "Load more" / scroll.

## HTTP caching
- Public GET endpoints that change rarely SHOULD set `@Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')` (see `settings.controller::getAppInfo` as canonical).
- Authenticated endpoints — don't cache publicly; private responses MUST NOT set `public` Cache-Control.

## Throttle
- See `.claude/rules/throttle.md` for per-route limits. Upload + auth-sensitive endpoints MUST declare `@Throttle(...)`.

## Rate-limit response
- When throwing 429 explicitly, include a `Retry-After` header. FE auto-retries GETs using this value.
