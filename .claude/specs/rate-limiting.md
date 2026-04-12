# Feature: Rate Limiting

## Status: done

## Context
Auth endpoints had no rate limiting — risk of brute force attacks on login/register/forgot-password.

## Acceptance Criteria
- [x] Global rate limit: 10 requests per minute per IP
- [x] Login endpoint: 5 requests per minute
- [x] Register endpoint: 5 requests per minute
- [x] Forgot password endpoint: 3 requests per minute

## Technical Notes
- Uses `@nestjs/throttler` ^6.5.0
- ThrottlerModule configured globally in app.module.ts (ttl: 60000, limit: 10)
- ThrottlerGuard added as APP_GUARD
- Stricter limits on auth endpoints via `@Throttle({ default: { ttl: 60000, limit: N } })` decorator

## Files Affected
- `src/app.module.ts` — ThrottlerModule + ThrottlerGuard
- `src/modules/auth/auth.controller.ts` — @Throttle on register, login, forgot-password
