import { ENV } from './env.constant';

export const COOKIE_KEYS = {
  ACCESS_TOKEN: 'access_token',
  REFRESH_TOKEN: 'refresh_token',
  // FE-readable flags. Edge middleware checks `is_authenticated=1` to gate
  // protected routes, and `user_role` to bypass maintenance for admins.
  // For password login the FE sets these itself in `useLogin.onSuccess`; for
  // OAuth the BE callback must set them server-side because there's no JS in
  // between the Google redirect and the dashboard navigation.
  IS_AUTHENTICATED: 'is_authenticated',
  USER_ROLE: 'user_role',
} as const;

const isProduction = ENV.NODE_ENV === 'production';

// Empty in localhost dev → cookies stay host-only on BE domain.
// In prod (split subdomain BE/FE) set `COOKIE_DOMAIN=.example.com` so the
// OAuth callback's Set-Cookie is readable on both `api.example.com` and
// `example.com`.
const cookieDomain = ENV.COOKIE_DOMAIN || undefined;

const BASE_OPTIONS = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax' as const,
  ...(cookieDomain && { domain: cookieDomain }),
};

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export const accessTokenCookieOptions = (maxAge: number) => ({
  ...BASE_OPTIONS,
  maxAge: maxAge * 1000,
});

export const refreshTokenCookieOptions = () => ({
  ...BASE_OPTIONS,
  path: '/',
  maxAge: ENV.JWT_REFRESH_TOKEN_EXPIRATION * 1000,
});

/**
 * Non-httpOnly cookies the FE / edge middleware reads. Mirror of `useLogin`
 * on the FE. Match key + maxAge there so password and OAuth flows produce
 * identical cookie state.
 */
export const fePublicCookieOptions = () => ({
  httpOnly: false,
  secure: isProduction,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: ONE_YEAR_SECONDS * 1000,
  ...(cookieDomain && { domain: cookieDomain }),
});

/**
 * Match-pair for `res.clearCookie` — browsers refuse to clear a cookie
 * whose domain attribute differs from the original Set-Cookie. Pair every
 * clearCookie call site with this so logout/session-revoke actually wipe.
 */
export const clearCookieOptions = (path: string = '/') => ({
  path,
  ...(cookieDomain && { domain: cookieDomain }),
});

/**
 * Logout-safe wipe: clears the cookie under BOTH scopes — current
 * domain-attributed (if `COOKIE_DOMAIN` is set) AND legacy host-only
 * (from before we adopted cross-subdomain cookies). Without this, stale
 * host-only cookies from a previous deploy would outlive `/auth/logout`
 * and keep `/auth/me` succeeding until the user manually cleared them.
 *
 * Express `res.clearCookie` is just a `Set-Cookie: ...; Max-Age=0` write,
 * so calling it twice with different attributes is safe — each emits a
 * separate header and the browser tombstones each match independently.
 */
export function clearAuthCookie(
  res: import('express').Response,
  name: string,
  path: string = '/',
): void {
  if (cookieDomain) {
    // Tombstone the domain-scoped cookie.
    res.clearCookie(name, { path, domain: cookieDomain });
  }
  // Always also tombstone the host-only version — covers legacy state.
  res.clearCookie(name, { path });
}
