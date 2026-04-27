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

const BASE_OPTIONS = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax' as const,
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
});
