/**
 * Unit tests for cookie.util.ts — cookieExtractor factory.
 */
import { cookieExtractor } from '@/core/utils/cookie.util';

describe('cookieExtractor', () => {
  it('extracts the named cookie from a request', () => {
    const extract = cookieExtractor('access_token');
    const req = { cookies: { access_token: 'abc.def.ghi' } };
    expect(extract(req)).toBe('abc.def.ghi');
  });

  it('returns null when the cookie is missing', () => {
    const extract = cookieExtractor('access_token');
    const req = { cookies: { other_cookie: 'xxx' } };
    expect(extract(req)).toBeNull();
  });

  it('returns null when cookies object is missing entirely', () => {
    const extract = cookieExtractor('access_token');
    expect(extract({} as Record<string, Record<string, string>>)).toBeNull();
  });

  it('returns null when req is null/undefined', () => {
    const extract = cookieExtractor('access_token');
    expect(
      extract(null as unknown as Record<string, Record<string, string>>),
    ).toBeNull();
  });

  it('returns a different value for a different cookie name', () => {
    const extractAccess = cookieExtractor('access_token');
    const extractRefresh = cookieExtractor('refresh_token');
    const req = {
      cookies: { access_token: 'A', refresh_token: 'R' },
    };
    expect(extractAccess(req)).toBe('A');
    expect(extractRefresh(req)).toBe('R');
  });
});
