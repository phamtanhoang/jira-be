/**
 * Unit tests for AuthService.loginWithOAuth().
 *
 * Important contract — same email = same account regardless of provider, so
 * password users can later sign in via Google without losing their data.
 *
 *   1. Email gets lowercased before lookup (case-insensitive identity)
 *   2. Unknown email → create user with emailVerified=now (no OTP roundtrip)
 *   3. Existing verified active user → reused as-is
 *   4. Existing unverified user → emailVerified flipped to now (provider proved ownership)
 *   5. Deactivated user → UnauthorizedException
 */
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from '@/modules/auth/auth.service';

function createMockPrisma() {
  return {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    refreshToken: {
      create: jest.fn().mockResolvedValue({ id: 'rt1' }),
    },
  };
}

function createMockJwt() {
  return { sign: jest.fn().mockReturnValue('access-jwt') };
}

describe('AuthService.loginWithOAuth()', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let jwt: ReturnType<typeof createMockJwt>;
  let service: AuthService;

  beforeEach(() => {
    prisma = createMockPrisma();
    jwt = createMockJwt();
    service = new AuthService(
      prisma as never,
      jwt as never,
      {} as never, // mail (not used in this path)
      { log: jest.fn() } as never, // audit
    );
  });

  it('lowercases the incoming email before lookup', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'u1',
      email: 'mixed@case.com',
      name: 'Mix',
      image: null,
      role: 'USER',
      active: true,
      emailVerified: new Date(),
    });
    await service.loginWithOAuth({
      email: 'Mixed@CASE.com',
      name: 'Mix',
      image: null,
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'mixed@case.com' },
    });
  });

  it('creates a new pre-verified user when email is unknown', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    prisma.user.create.mockResolvedValueOnce({
      id: 'u-new',
      email: 'new@example.com',
      name: 'New User',
      image: 'https://avatar.example/x.png',
      role: 'USER',
      active: true,
      emailVerified: new Date(),
    });

    const result = await service.loginWithOAuth({
      email: 'new@example.com',
      name: 'New User',
      image: 'https://avatar.example/x.png',
    });

    const data = prisma.user.create.mock.calls[0][0].data;
    expect(data.email).toBe('new@example.com');
    expect(data.name).toBe('New User');
    expect(data.image).toBe('https://avatar.example/x.png');
    // OAuth bypasses the email-OTP loop — emailVerified set immediately
    expect(data.emailVerified).toBeInstanceOf(Date);
    expect(result.user.id).toBe('u-new');
    expect(result.accessToken).toBe('access-jwt');
  });

  it('reuses an existing verified+active user without re-creating', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'u-existing',
      email: 'me@example.com',
      name: 'Me',
      image: null,
      role: 'USER',
      active: true,
      emailVerified: new Date('2026-01-01'),
    });

    const result = await service.loginWithOAuth({
      email: 'me@example.com',
      name: 'Me-renamed-on-google',
      image: null,
    });

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(result.user.id).toBe('u-existing');
  });

  it('flips emailVerified=now when an unverified user signs in via OAuth', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'u-unverified',
      email: 'unv@example.com',
      name: 'Unv',
      image: null,
      role: 'USER',
      active: true,
      emailVerified: null,
    });
    prisma.user.update.mockResolvedValueOnce({
      id: 'u-unverified',
      email: 'unv@example.com',
      name: 'Unv',
      image: null,
      role: 'USER',
      active: true,
      emailVerified: new Date(),
    });

    await service.loginWithOAuth({
      email: 'unv@example.com',
      name: 'Unv',
      image: null,
    });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-unverified' },
      data: { emailVerified: expect.any(Date) },
    });
  });

  it('rejects deactivated accounts with UnauthorizedException', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'u-banned',
      email: 'bad@example.com',
      name: 'Banned',
      image: null,
      role: 'USER',
      active: false,
      emailVerified: new Date(),
    });

    await expect(
      service.loginWithOAuth({
        email: 'bad@example.com',
        name: 'Banned',
        image: null,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('returns auth tokens + slimmed-down user object', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'u1',
      email: 'a@b.co',
      name: 'A',
      image: null,
      role: 'ADMIN',
      active: true,
      emailVerified: new Date(),
      // password should NOT leak through
      password: 'should-not-be-returned',
    });

    const result = await service.loginWithOAuth({
      email: 'a@b.co',
      name: 'A',
      image: null,
    });

    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');
    expect(result.user).toEqual({
      id: 'u1',
      email: 'a@b.co',
      name: 'A',
      image: null,
      role: 'ADMIN',
    });
    // Password fingerprint MUST NOT be in the response
    expect((result.user as Record<string, unknown>).password).toBeUndefined();
  });
});
