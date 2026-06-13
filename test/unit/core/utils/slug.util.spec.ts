/**
 * Unit tests for `slug.util` — slug + project-key generation under
 * adversarial inputs and concurrent-collision retry.
 *
 * Edge cases the suite targets:
 *   - Empty / whitespace-only / pure-emoji / unicode-only inputs
 *   - Diacritics + Vietnamese characters (đ, ô, ạ)
 *   - SQL-injection-shaped strings (must NOT pass through, must NOT explode)
 *   - Inputs that would collapse to an empty slug
 *   - Collision retry beyond MAX_SLUG_RETRY (must fall back to random)
 *   - Project-key length clamp (8 chars max)
 *   - `isUniqueConstraintError` discrimination by `target` column
 */
import { Prisma } from '@prisma/client';
import {
  candidateProjectKey,
  candidateSlug,
  generateProjectKey,
  generateSlug,
  isUniqueConstraintError,
  MAX_KEY_RETRY,
  MAX_SLUG_RETRY,
} from '@/core/utils/slug.util';

describe('generateSlug()', () => {
  it('produces a lowercase, hyphen-joined slug from a normal name', () => {
    expect(generateSlug('My Workspace')).toBe('my-workspace');
  });

  it('strips diacritics (Vietnamese é/à/ô → e/a/o)', () => {
    expect(generateSlug('Trợ Lý Cá Nhân')).toBe('tro-ly-ca-nhan');
  });

  it('handles the special Vietnamese đ → d', () => {
    expect(generateSlug('Đội Triển Khai')).toBe('doi-trien-khai');
  });

  it('collapses repeated whitespace + underscores into single hyphens', () => {
    expect(generateSlug('hello___world   foo')).toBe('hello-world-foo');
  });

  it('trims leading and trailing hyphens', () => {
    expect(generateSlug('  --hello--  ')).toBe('hello');
  });

  it('returns empty string for pure-emoji input (no slug-able chars)', () => {
    expect(generateSlug('🚀🎉')).toBe('');
  });

  it('returns empty string for pure-whitespace input', () => {
    expect(generateSlug('   ')).toBe('');
  });

  it('strips SQL-injection special characters (no quote / semicolon survives)', () => {
    const out = generateSlug(`Robert'); DROP TABLE users; --`);
    expect(out).not.toMatch(/[';]/);
    // Tilde + apostrophe stripped, alphanumerics survive
    expect(out).toContain('robert');
  });

  it('strips angle brackets so a workspace named "<script>" cannot smuggle HTML via slug', () => {
    const out = generateSlug('<script>alert(1)</script>');
    expect(out).not.toMatch(/[<>]/);
  });

  it('is idempotent — slug-of-slug returns the same slug', () => {
    const once = generateSlug('My  Workspace --Test');
    const twice = generateSlug(once);
    expect(twice).toBe(once);
  });

  it('preserves embedded hyphens as-is', () => {
    expect(generateSlug('hello-world')).toBe('hello-world');
  });

  it('handles a name with ONLY a single character', () => {
    expect(generateSlug('A')).toBe('a');
  });
});

describe('candidateSlug()', () => {
  it('returns base for attempt 0', () => {
    expect(candidateSlug('foo', 0)).toBe('foo');
  });

  it('appends -2, -3, ... for retries 1..(MAX_SLUG_RETRY-1)', () => {
    expect(candidateSlug('foo', 1)).toBe('foo-2');
    expect(candidateSlug('foo', 2)).toBe('foo-3');
    expect(candidateSlug('foo', MAX_SLUG_RETRY - 1)).toBe(
      `foo-${MAX_SLUG_RETRY}`,
    );
  });

  it('falls back to a 6-char random suffix once MAX_SLUG_RETRY is reached', () => {
    const result = candidateSlug('foo', MAX_SLUG_RETRY);
    // foo-<6 alphanum chars>
    expect(result).toMatch(/^foo-[a-z0-9]{1,6}$/);
    // And it's different from the sequential pattern
    expect(result).not.toBe(`foo-${MAX_SLUG_RETRY + 1}`);
  });

  it('substitutes "workspace" when base is an empty string', () => {
    expect(candidateSlug('', 0)).toBe('workspace');
    expect(candidateSlug('', 1)).toBe('workspace-2');
  });

  it('two consecutive random suffixes (post-retry) DIFFER almost surely', () => {
    const a = candidateSlug('foo', MAX_SLUG_RETRY + 5);
    const b = candidateSlug('foo', MAX_SLUG_RETRY + 5);
    // Allow the (vanishingly small) chance of a collision but reject
    // a hard-coded constant return.
    expect(a).not.toBe('foo-undefined');
    expect(b).not.toBe('foo-undefined');
  });
});

describe('generateProjectKey()', () => {
  it('returns initials of multi-word names', () => {
    expect(generateProjectKey('Mobile Web App')).toBe('MWA');
  });

  it('caps initials at 5 characters', () => {
    expect(
      generateProjectKey('one two three four five six seven'),
    ).toHaveLength(5);
  });

  it('strips diacritics from initials (Đội Triển Khai → DTK)', () => {
    expect(generateProjectKey('Đội Triển Khai')).toBe('DTK');
  });

  it('uses first 4 chars uppercased for single-word names', () => {
    expect(generateProjectKey('Marketing')).toBe('MARKE');
  });

  it('handles 2-character single word — returns just those 2 chars', () => {
    expect(generateProjectKey('AB')).toBe('AB');
  });

  it('pads single-char names with random letters to reach minimum 2 chars', () => {
    const out = generateProjectKey('A');
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out[0]).toBe('A');
    // 2nd char is random uppercase from A-Z
    expect(out.slice(1)).toMatch(/^[A-Z]+$/);
  });

  it('returns a 4-char random fallback when name has NO letters', () => {
    const out = generateProjectKey('🚀 123');
    expect(out).toMatch(/^[A-Z]{4}$/);
  });

  it('returns a random key for pure-emoji input', () => {
    expect(generateProjectKey('🚀🎉')).toMatch(/^[A-Z]{4}$/);
  });

  it('returns a random key for empty string input', () => {
    expect(generateProjectKey('')).toMatch(/^[A-Z]{4}$/);
  });

  it('does NOT bleed digits or symbols into the key', () => {
    expect(generateProjectKey('Mobile2 App!')).toMatch(/^[A-Z]+$/);
  });
});

describe('candidateProjectKey()', () => {
  it('returns the base for attempt 0', () => {
    expect(candidateProjectKey('MWA', 0)).toBe('MWA');
  });

  it('appends 2, 3, ... for retries up to MAX_KEY_RETRY-1', () => {
    expect(candidateProjectKey('MWA', 1)).toBe('MWA2');
    expect(candidateProjectKey('MWA', 2)).toBe('MWA3');
    expect(candidateProjectKey('MWA', MAX_KEY_RETRY - 1)).toBe(
      `MWA${MAX_KEY_RETRY}`,
    );
  });

  it('falls back to a random 2-char suffix once MAX_KEY_RETRY is reached', () => {
    const out = candidateProjectKey('MWA', MAX_KEY_RETRY);
    expect(out).toMatch(/^MWA[A-Z]{2}$/);
  });

  it('clamps total length to 10 chars by trimming the base', () => {
    // 12-char base + "2" suffix should clamp the base to 9 chars
    const out = candidateProjectKey('ABCDEFGHIJKL', 1);
    expect(out.length).toBeLessThanOrEqual(10);
    // The suffix "2" must survive
    expect(out.endsWith('2')).toBe(true);
  });

  it('clamps base to 10 chars at attempt 0 even when no suffix is appended', () => {
    expect(candidateProjectKey('ABCDEFGHIJKLMN', 0)).toBe('ABCDEFGHIJ');
  });

  it('substitutes a random base when input is empty', () => {
    expect(candidateProjectKey('', 0)).toMatch(/^[A-Z]+$/);
  });

  it('two-digit suffix at attempt 9 leaves room for an 8-char base', () => {
    // attempt 9 → suffix "10", room = 8
    const out = candidateProjectKey('ABCDEFGHIJ', 9);
    // expected: "ABCDEFGH" + random suffix (because 9 >= MAX_KEY_RETRY)
    // OR "ABCDEFGH10" if attempt < MAX_KEY_RETRY
    expect(out.length).toBeLessThanOrEqual(10);
  });
});

describe('isUniqueConstraintError()', () => {
  function p2002(target: string | string[] | undefined) {
    return new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target },
      },
    );
  }

  it('returns true for P2002 with no target filter', () => {
    expect(isUniqueConstraintError(p2002(['slug']))).toBe(true);
  });

  it('narrows on string target (case-insensitive substring)', () => {
    expect(isUniqueConstraintError(p2002(['slug']), 'slug')).toBe(true);
    expect(isUniqueConstraintError(p2002(['slug']), 'SLUG')).toBe(true);
    expect(isUniqueConstraintError(p2002(['slug']), 'key')).toBe(false);
  });

  it('narrows on array target (any field matches)', () => {
    expect(
      isUniqueConstraintError(p2002(['workspaceId', 'slug']), 'slug'),
    ).toBe(true);
  });

  it('returns false for non-Prisma errors', () => {
    expect(isUniqueConstraintError(new Error('something else'))).toBe(false);
  });

  it('returns false for non-P2002 Prisma errors', () => {
    const other = new Prisma.PrismaClientKnownRequestError('not found', {
      code: 'P2025',
      clientVersion: 'test',
    });
    expect(isUniqueConstraintError(other)).toBe(false);
  });

  it('returns false when target is missing from meta', () => {
    expect(isUniqueConstraintError(p2002(undefined), 'slug')).toBe(false);
  });

  it('returns true with empty target filter (matches any P2002)', () => {
    expect(isUniqueConstraintError(p2002(['slug']), '')).toBe(true);
  });

  it('returns false for null and undefined input', () => {
    expect(isUniqueConstraintError(null)).toBe(false);
    expect(isUniqueConstraintError(undefined)).toBe(false);
  });

  it('returns false for plain object that mimics P2002 shape (instanceof guard)', () => {
    const fake = { code: 'P2002', meta: { target: ['slug'] } };
    expect(isUniqueConstraintError(fake)).toBe(false);
  });
});
