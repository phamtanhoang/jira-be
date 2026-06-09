import { Prisma } from '@prisma/client';

/**
 * Columns selected for `req.user` on every authenticated request. We
 * intentionally include `password` here ONLY for the `hasPassword`
 * derivation in `JwtStrategy.validate()`; the strategy strips the raw
 * hash before returning, so the actual `AuthUser` exposed to controllers
 * NEVER contains a password value. Lookup is read-only and cheap (one
 * column added to an already-existing findUnique).
 */
export const AUTH_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  emailVerified: true,
  image: true,
  role: true,
  password: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

type RawAuthUser = Prisma.UserGetPayload<{
  select: typeof AUTH_USER_SELECT;
}>;

/**
 * Shape exposed to controllers via `@CurrentUser()` and to the client
 * via GET `/auth/me`. The raw `password` hash is REPLACED by a derived
 * boolean — the FE needs to know whether the user has a password (to
 * show "Change password" vs "Set password" + skip the currentPassword
 * field for OAuth-only users) but never the hash itself.
 */
export type AuthUser = Omit<RawAuthUser, 'password'> & {
  hasPassword: boolean;
};

export interface JwtPayload {
  sub: string;
  email: string;
}
