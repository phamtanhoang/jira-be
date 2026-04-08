import { Prisma } from '@prisma/client';

export const AUTH_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  emailVerified: true,
  image: true,
  role: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export type AuthUser = Prisma.UserGetPayload<{
  select: typeof AUTH_USER_SELECT;
}>;

export interface JwtPayload {
  sub: string;
  email: string;
}
