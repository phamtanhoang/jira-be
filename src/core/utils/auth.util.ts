import { randomBytes, randomInt, randomUUID } from 'crypto';
import { hash, compare } from 'bcryptjs';

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, 12);
}

/**
 * Validate password against hashed password
 */
export async function validatePassword(
  password: string,
  hashedPassword: string,
): Promise<boolean> {
  return compare(password, hashedPassword);
}

/**
 * Generate a 6-digit OTP
 */
export function generateOTP(): string {
  return randomInt(100000, 999999).toString();
}

/**
 * Calculate expiry date from seconds
 */
export function calculateExpiryDate(secondsFromNow: number): Date {
  return new Date(Date.now() + secondsFromNow * 1000);
}

/**
 * Generate a refresh token UUID
 */
export function generateRefreshToken(): string {
  return randomUUID();
}

/**
 * Generate a URL-safe random token for public share / invite links.
 * 32-byte base64url is comfortably collision-free and copy-paste friendly.
 * Strips padding and replaces +/ with -_ so it survives unencoded in URLs.
 */
export function generateShareToken(): string {
  // 24 bytes → 32 base64 chars after padding strip
  return randomBytes(24)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
