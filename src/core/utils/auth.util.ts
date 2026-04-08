import { randomInt, randomUUID } from 'crypto';
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
