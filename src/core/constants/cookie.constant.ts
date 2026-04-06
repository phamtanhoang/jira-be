export const COOKIE_KEYS = {
  ACCESS_TOKEN: 'access_token',
  REFRESH_TOKEN: 'refresh_token',
} as const;

const isProduction = process.env.NODE_ENV === 'production';

const BASE_OPTIONS = {
  httpOnly: true,
  secure: isProduction,
  sameSite: 'lax' as const,
};

export const accessTokenCookieOptions = (maxAge: number) => ({
  ...BASE_OPTIONS,
  maxAge: maxAge * 1000,
});

export const refreshTokenCookieOptions = () => ({
  ...BASE_OPTIONS,
  path: '/auth/refresh',
  maxAge: parseInt(process.env.JWT_REFRESH_TOKEN_EXPIRATION!) * 1000,
});
