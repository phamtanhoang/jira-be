/**
 * Upload limits + mime allowlists.
 *
 * Single source of truth — controllers + services MUST import from here
 * instead of redeclaring locally. If an allowlist needs to expand, expand
 * it once here and every consumer is updated consistently.
 */

const MB = 1024 * 1024;

export const UPLOAD_LIMITS = {
  // Single-shot small attachment (whole file in one request).
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
  // Chunked / resumable upload for files that exceed ATTACHMENT.maxSize.
  // Mime allowlist mirrors ATTACHMENT so the same validation rules apply.
  // Per-chunk size is the multer body limit per single POST; total size
  // bounds the assembled file. Session TTL is how long a half-finished
  // upload survives before the cleanup cron drops its temp chunks.
  LARGE_ATTACHMENT: {
    maxSize: 200 * MB,
    chunkSize: 5 * MB,
    chunkUploadCap: 6 * MB, // 5 MB chunk + small headroom for multipart envelope
    sessionTtlMs: 60 * 60 * 1000, // 1 hour
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
      'video/mp4',
      'video/quicktime',
      'video/webm',
      'audio/mpeg',
      'audio/wav',
      'audio/ogg',
    ] as readonly string[],
  },
} as const;

export function isAllowedMime(
  limits: { mimes: readonly string[] },
  mime: string,
): boolean {
  return limits.mimes.includes(mime);
}
