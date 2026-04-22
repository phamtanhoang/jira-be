/**
 * Unit tests for timezone.util.ts
 *
 * Covers:
 *  - isValidTimezone / resolveTimezone (validation + fallback)
 *  - convertDateToTimezone (Date → ISO string in target tz)
 *  - transformDatesInResponse (recursive Date replacement)
 */
import {
  convertDateToTimezone,
  isValidTimezone,
  resolveTimezone,
  transformDatesInResponse,
} from '@/core/utils/timezone.util';

describe('isValidTimezone', () => {
  it('accepts valid IANA timezones', () => {
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Asia/Ho_Chi_Minh')).toBe(true);
    expect(isValidTimezone('America/New_York')).toBe(true);
  });

  it('rejects invalid timezones', () => {
    expect(isValidTimezone('Invalid/Zone')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
  });
});

describe('resolveTimezone', () => {
  it('returns the header value when valid', () => {
    expect(resolveTimezone('Asia/Ho_Chi_Minh')).toBe('Asia/Ho_Chi_Minh');
  });

  it('falls back to UTC when header is missing', () => {
    expect(resolveTimezone(undefined)).toBe('UTC');
  });

  it('falls back to UTC when header is invalid', () => {
    expect(resolveTimezone('Invalid/Zone')).toBe('UTC');
  });
});

describe('convertDateToTimezone', () => {
  it('returns an ISO-8601 string with timezone offset', () => {
    const date = new Date('2026-04-22T00:00:00.000Z');
    const result = convertDateToTimezone(date, 'UTC');

    expect(result).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/,
    );
    expect(result).toContain('+00:00');
  });

  it('includes the correct offset for Asia/Ho_Chi_Minh (+07:00)', () => {
    const date = new Date('2026-04-22T00:00:00.000Z');
    const result = convertDateToTimezone(date, 'Asia/Ho_Chi_Minh');
    expect(result).toContain('+07:00');
    // 00:00 UTC → 07:00 local
    expect(result).toMatch(/T07:00:00/);
  });
});

describe('transformDatesInResponse', () => {
  it('transforms a single Date to an ISO string', () => {
    const result = transformDatesInResponse(
      new Date('2026-04-22T00:00:00.000Z'),
      'UTC',
    );
    expect(typeof result).toBe('string');
    expect(result).toContain('2026-04-22');
  });

  it('leaves primitives unchanged', () => {
    expect(transformDatesInResponse('hello', 'UTC')).toBe('hello');
    expect(transformDatesInResponse(42, 'UTC')).toBe(42);
    expect(transformDatesInResponse(true, 'UTC')).toBe(true);
    expect(transformDatesInResponse(null, 'UTC')).toBe(null);
  });

  it('transforms Dates nested inside objects', () => {
    const input = {
      id: 'abc',
      createdAt: new Date('2026-04-22T00:00:00.000Z'),
      meta: { updatedAt: new Date('2026-04-23T00:00:00.000Z') },
    };
    const result = transformDatesInResponse(input, 'UTC') as {
      id: string;
      createdAt: string;
      meta: { updatedAt: string };
    };

    expect(result.id).toBe('abc');
    expect(typeof result.createdAt).toBe('string');
    expect(result.createdAt).toContain('2026-04-22');
    expect(typeof result.meta.updatedAt).toBe('string');
    expect(result.meta.updatedAt).toContain('2026-04-23');
  });

  it('transforms Dates inside arrays', () => {
    const dates = [
      new Date('2026-04-22T00:00:00.000Z'),
      new Date('2026-04-23T00:00:00.000Z'),
    ];
    const result = transformDatesInResponse(dates, 'UTC') as string[];
    expect(result).toHaveLength(2);
    expect(typeof result[0]).toBe('string');
    expect(typeof result[1]).toBe('string');
  });
});
