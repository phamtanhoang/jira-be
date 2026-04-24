/**
 * Upload limits + mime allowlists.
 *
 * Single source of truth — controllers + services MUST import from here
 * instead of redeclaring locally. If an allowlist needs to expand, expand
 * it once here and every consumer is updated consistently.
 */

const MB = 1024 * 1024;

export const UPLOAD_LIMITS = {
  ATTACHMENT: {
    maxSize: 10 * MB,
    maxFiles: 10,
    mimes: [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml',
      'application/pdf',
      'application/zip',
      'application/x-zip-compressed',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
      'text/csv',
    ] as readonly string[],
  },
  AVATAR: {
    maxSize: 2 * MB,
    mimes: [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
    ] as readonly string[],
  },
  LOGO: {
    maxSize: 2 * MB,
    mimes: [
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/svg+xml',
      'image/gif',
    ] as readonly string[],
  },
} as const;

export function isAllowedMime(
  limits: { mimes: readonly string[] },
  mime: string,
): boolean {
  return limits.mimes.includes(mime);
}
