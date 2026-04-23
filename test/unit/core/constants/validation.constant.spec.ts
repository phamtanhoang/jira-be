/**
 * Tests for REGEX constants — mirrors FE regex tests.
 * These regexes are the single source of truth for server-side validation.
 */
import { REGEX } from '@/core/constants/validation.constant';

describe('REGEX.EMAIL', () => {
  it('accepts standard emails', () => {
    expect(REGEX.EMAIL.test('a@b.co')).toBe(true);
    expect(REGEX.EMAIL.test('john@example.com')).toBe(true);
    expect(REGEX.EMAIL.test('user.name+tag@example.com')).toBe(true);
  });

  it('rejects missing @', () => {
    expect(REGEX.EMAIL.test('noatsign.com')).toBe(false);
  });

  it('rejects missing domain / TLD', () => {
    expect(REGEX.EMAIL.test('a@')).toBe(false);
    expect(REGEX.EMAIL.test('a@b')).toBe(false);
  });

  it('rejects spaces', () => {
    expect(REGEX.EMAIL.test('a b@c.com')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(REGEX.EMAIL.test('')).toBe(false);
  });
});

describe('REGEX.PASSWORD', () => {
  it('accepts a password with upper/lower/digit/special and 8+ chars', () => {
    expect(REGEX.PASSWORD.test('Pass@123')).toBe(true);
    expect(REGEX.PASSWORD.test('Aa1@aaaa')).toBe(true);
  });

  it('rejects missing uppercase', () => {
    expect(REGEX.PASSWORD.test('pass@123')).toBe(false);
  });

  it('rejects missing lowercase', () => {
    expect(REGEX.PASSWORD.test('PASS@123')).toBe(false);
  });

  it('rejects missing digit', () => {
    expect(REGEX.PASSWORD.test('Password@')).toBe(false);
  });

  it('rejects missing special char', () => {
    expect(REGEX.PASSWORD.test('Password1')).toBe(false);
  });

  it('rejects under 8 chars', () => {
    expect(REGEX.PASSWORD.test('Aa1@aa')).toBe(false);
  });
});
