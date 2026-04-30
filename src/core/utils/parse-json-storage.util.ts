/**
 * Narrow type guards for Prisma `JsonValue` columns.
 *
 * Prisma stores arbitrary JSON as `Prisma.JsonValue` — a union too wide to
 * use directly. Service code knows the actual shape because the DTO that
 * wrote the row validated it via `class-validator`. But the read-side has
 * no way to express that and ends up with `as unknown as MyShape` casts
 * that silently break if a malformed row sneaks in (manual SQL, schema
 * drift, future migration bug).
 *
 * These helpers do a runtime shape check at the read boundary and return
 * `null` for invalid input so the caller can decide whether to skip,
 * default, or surface an error.
 */

/**
 * Cast a JSON column to `string[]`. Returns `[]` for any non-array or
 * empty input, so callers can treat malformed rows as "no options".
 */
export function parseStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string');
}
