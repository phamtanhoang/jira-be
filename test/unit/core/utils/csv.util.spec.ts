/**
 * Unit tests for csv.util.ts — RFC 4180 cell escape.
 *
 * Used by the issues CSV export endpoint. Encoding correctness matters:
 * a stray unescaped comma turns one row into two, an unescaped quote
 * desynchronizes the parser for the rest of the file.
 */
import { csvEscape } from '@/core/utils/csv.util';

describe('csvEscape()', () => {
  // ─── Empty / null handling ───────────────────────────
  it.each([
    [null, ''],
    [undefined, ''],
    ['', ''],
  ])('returns empty string for %p', (input, expected) => {
    expect(csvEscape(input)).toBe(expected);
  });

  // ─── No-op cases (no special chars) ──────────────────
  it('passes plain text through unchanged', () => {
    expect(csvEscape('hello world')).toBe('hello world');
    expect(csvEscape('PROJ-42')).toBe('PROJ-42');
  });

  it('stringifies numbers without quoting', () => {
    expect(csvEscape(42)).toBe('42');
    expect(csvEscape(0)).toBe('0');
    expect(csvEscape(-1.5)).toBe('-1.5');
  });

  it('stringifies booleans without quoting', () => {
    expect(csvEscape(true)).toBe('true');
    expect(csvEscape(false)).toBe('false');
  });

  it('stringifies bigint without quoting', () => {
    expect(csvEscape(BigInt('9007199254740993'))).toBe('9007199254740993');
  });

  // ─── Quoting required ────────────────────────────────
  it('wraps in quotes when value contains a comma', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
  });

  it('wraps in quotes when value contains CR or LF', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
    expect(csvEscape('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  it('doubles embedded quotes and wraps the result', () => {
    // RFC 4180: a literal " becomes "" inside a quoted field
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });

  it('handles a value that is just a single quote', () => {
    expect(csvEscape('"')).toBe('""""'); // outer quotes + doubled inner
  });

  it('quotes a value that contains both a comma and a quote', () => {
    expect(csvEscape('foo,"bar"')).toBe('"foo,""bar"""');
  });

  // ─── Object handling — avoids [object Object] trap ───
  it('serializes objects as JSON, then quotes when JSON contains commas', () => {
    expect(csvEscape({ a: 1, b: 2 })).toBe('"{""a"":1,""b"":2}"');
  });

  it('serializes arrays as JSON', () => {
    expect(csvEscape([1, 2, 3])).toBe('"[1,2,3]"');
  });

  it('serializes Date as JSON ISO string (Date.toJSON)', () => {
    const d = new Date('2026-04-25T12:34:56.000Z');
    // Date stringifies through JSON.stringify → wrapped in quotes
    expect(csvEscape(d)).toBe('"""2026-04-25T12:34:56.000Z"""');
  });

  // ─── Round-trip sanity ───────────────────────────────
  it('builds a valid 3-cell row when joined with commas', () => {
    const cells = ['key', 'summary, with comma', 'has "quotes"'];
    const row = cells.map(csvEscape).join(',');
    expect(row).toBe('key,"summary, with comma","has ""quotes"""');
  });
});
