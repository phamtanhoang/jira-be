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
