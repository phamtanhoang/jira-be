import { Prisma } from '@prisma/client';

/**
 * Deterministic slug from a free-text name.
 * - Lowercased, trimmed.
 * - Diacritics + non-word chars stripped (handles Vietnamese names too).
 * - Spaces / underscores collapse to `-`.
 * - Empty string when the input has no slug-able chars.
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * Build a candidate slug for the Nth retry attempt. attempt 0 -> base slug,
 * attempts 1..(MAX_SLUG_RETRY-1) -> `base-2`, `base-3`, ... Anything past
 * that falls back to a short random suffix so concurrent collisions still
 * terminate in O(1) attempts.
 */
export const MAX_SLUG_RETRY = 10;

export function candidateSlug(base: string, attempt: number): string {
  const safeBase = base || 'workspace';
  if (attempt <= 0) return safeBase;
  if (attempt < MAX_SLUG_RETRY) return `${safeBase}-${attempt + 1}`;
  return `${safeBase}-${randomSuffix()}`;
}

/**
 * Detect Prisma "unique constraint violated" errors (P2002). Optionally
 * narrow on the target column name (e.g. `slug`, `key`, `name`) so the
 * caller can re-throw a domain-specific error per constraint instead of
 * conflating them.
 */
export function isUniqueConstraintError(
  err: unknown,
  target?: string,
): err is Prisma.PrismaClientKnownRequestError {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== 'P2002') return false;
  if (!target) return true;
  const meta = (err.meta ?? {}) as { target?: string | string[] };
  const fields = Array.isArray(meta.target)
    ? meta.target
    : typeof meta.target === 'string'
      ? [meta.target]
      : [];
  return fields.some((f) => f.toLowerCase().includes(target.toLowerCase()));
}

/**
 * Derive a project key from a free-text name. Used by `ProjectsService` when
 * the caller omits an explicit key — we'd rather let the BE pick a sensible
 * default than ask the user to come up with one and then fail their request
 * because it collides with another project in the same workspace.
 *
 * Rules:
 * - Multi-word names → initials, up to 5 chars (e.g. "Mobile Web App" → "MWA").
 * - Single-word names → first 4 chars uppercased (e.g. "Marketing" → "MARK").
 * - Strips accents (Vietnamese: "Đội Triển Khai" → "DTK").
 * - Always >= 2 chars; pads with random A-Z if the input has no usable letters.
 */
export function generateProjectKey(name: string): string {
  const cleaned = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toUpperCase();

  const words = cleaned.split(/[^A-Z]+/).filter(Boolean);
  if (words.length === 0) return randomKey(4);

  if (words.length >= 2) {
    const initials = words
      .map((w) => w[0])
      .join('')
      .slice(0, 5);
    if (initials.length >= 2) return initials;
  }

  const single = words[0];
  if (single.length >= 2) return single.slice(0, 5);

  // Single 1-char word — pad with a couple of random letters to satisfy the
  // 2-char minimum.
  return (single + randomKey(2)).slice(0, 5);
}

function randomKey(len: number): string {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

/**
 * Candidate project key for the Nth retry attempt. Lets the service walk
 * through "MARK" → "MARK2" → "MARK3" … on collision, then random suffix
 * after MAX_KEY_RETRY. Total length is clamped to 10 to keep issue keys
 * (`MARK2-42`) readable.
 */
export const MAX_KEY_RETRY = 9;
const MAX_KEY_LENGTH = 10;

export function candidateProjectKey(base: string, attempt: number): string {
  const safeBase = base || randomKey(4);
  if (attempt <= 0) return safeBase.slice(0, MAX_KEY_LENGTH);
  if (attempt < MAX_KEY_RETRY) {
    const suffix = String(attempt + 1);
    // Trim base so base + suffix never exceeds the column limit. With the
    // current cap of 10 chars and single-digit suffix this is rarely an
    // issue, but the slice is defensive.
    const room = MAX_KEY_LENGTH - suffix.length;
    return safeBase.slice(0, room) + suffix;
  }
  // Final resort under heavy contention — random 2-char suffix.
  const suffix = randomKey(2);
  const room = MAX_KEY_LENGTH - suffix.length;
  return safeBase.slice(0, room) + suffix;
}
