/**
 * Unit tests for auth.util.ts
 *
 * Tests pure crypto helpers — no DB, no Nest bootstrap.
 */
import {
  calculateExpiryDate,
  generateOTP,
  generateRefreshToken,
  hashPassword,
  validatePassword,
} from '@/core/utils/auth.util';

describe('hashPassword + validatePassword', () => {
  it('hashes a password and validates it against the hash', async () => {
    const password = 'Pass@123';
    const hashed = await hashPassword(password);

    expect(hashed).not.toBe(password);
    expect(hashed.length).toBeGreaterThan(20);
    expect(await validatePassword(password, hashed)).toBe(true);
  });

  it('returns false when password does not match hash', async () => {
    const hashed = await hashPassword('Pass@123');
    expect(await validatePassword('WrongPass', hashed)).toBe(false);
  });

  it('produces different hashes for the same password (salted)', async () => {
    const a = await hashPassword('Pass@123');
    const b = await hashPassword('Pass@123');
    expect(a).not.toBe(b);
  });
});

describe('generateOTP', () => {
  it('returns a 6-digit numeric string', () => {
    const otp = generateOTP();
    expect(otp).toMatch(/^\d{6}$/);
  });

  it('returns a value between 100000 and 999999', () => {
    for (let i = 0; i < 20; i++) {
      const n = parseInt(generateOTP(), 10);
      expect(n).toBeGreaterThanOrEqual(100000);
      expect(n).toBeLessThanOrEqual(999999);
    }
  });
});

describe('calculateExpiryDate', () => {
  it('returns a Date N seconds in the future', () => {
    const before = Date.now();
    const expiry = calculateExpiryDate(60);
    const after = Date.now();

    expect(expiry.getTime()).toBeGreaterThanOrEqual(before + 60_000);
    expect(expiry.getTime()).toBeLessThanOrEqual(after + 60_000);
  });

  it('handles 0 seconds (returns now)', () => {
    const before = Date.now();
    const expiry = calculateExpiryDate(0);
    expect(expiry.getTime()).toBeGreaterThanOrEqual(before);
    expect(expiry.getTime()).toBeLessThanOrEqual(before + 100);
  });
});

describe('generateRefreshToken', () => {
  it('returns a UUID v4 string', () => {
    const token = generateRefreshToken();
    expect(token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('returns a unique value on each call', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a).not.toBe(b);
  });
});
