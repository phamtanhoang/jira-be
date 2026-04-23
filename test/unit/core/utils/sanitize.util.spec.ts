/**
 * Unit tests for sanitize.util.ts — ensures sensitive fields never leak
 * into request/response logs.
 */
import {
  REDACTED_BODY_ROUTES,
  sanitize,
  sanitizeHeaders,
  shouldDropRequestBody,
  shouldSkipResponseBody,
} from '@/core/utils/sanitize.util';

describe('sanitize()', () => {
  it('returns primitives unchanged', () => {
    expect(sanitize('hello')).toBe('hello');
    expect(sanitize(42)).toBe(42);
    expect(sanitize(true)).toBe(true);
    expect(sanitize(null)).toBe(null);
    expect(sanitize(undefined)).toBe(undefined);
  });

  it('masks password field', () => {
    expect(sanitize({ email: 'a@b.co', password: 'secret123' })).toEqual({
      email: 'a@b.co',
      password: '***',
    });
  });

  it('masks many sensitive keys regardless of casing', () => {
    const input = {
      Password: 'x',
      ACCESS_TOKEN: 'y',
      refreshToken: 'z',
      OTP: '123456',
      apiKey: 'k',
      secret: 's',
    };
    const out = sanitize(input) as Record<string, string>;
    expect(out.Password).toBe('***');
    expect(out.ACCESS_TOKEN).toBe('***');
    expect(out.refreshToken).toBe('***');
    expect(out.OTP).toBe('***');
    expect(out.apiKey).toBe('***');
    expect(out.secret).toBe('***');
  });

  it('masks sensitive keys nested inside objects and arrays', () => {
    const input = {
      user: { email: 'a@b.co', password: 'x' },
      credentials: [{ token: 't1' }, { token: 't2' }],
    };
    const out = sanitize(input) as {
      user: { email: string; password: string };
      credentials: { token: string }[];
    };
    expect(out.user.password).toBe('***');
    expect(out.credentials[0].token).toBe('***');
    expect(out.credentials[1].token).toBe('***');
    expect(out.user.email).toBe('a@b.co');
  });

  it('handles circular references without throwing', () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    const out = sanitize(obj) as Record<string, unknown>;
    expect(out.a).toBe(1);
    expect(out.self).toBe('[Circular]');
  });

  it('caps recursion depth', () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 20; i++) deep = { child: deep };
    const out = sanitize(deep);
    expect(JSON.stringify(out)).toContain('[MaxDepth]');
  });

  it('truncates payloads larger than 32KB', () => {
    const big = { data: 'x'.repeat(40_000) };
    const out = sanitize(big) as { _truncated: boolean; size: number };
    expect(out._truncated).toBe(true);
    expect(out.size).toBeGreaterThan(32_000);
  });

  it('does NOT mask non-sensitive fields with similar names', () => {
    const out = sanitize({
      description: 'my password is cool',
      passwordHintLabel: 'Type your password',
    }) as Record<string, string>;
    expect(out.description).toBe('my password is cool');
    // passwordHintLabel is NOT in the sensitive list — unchanged
    expect(out.passwordHintLabel).toBe('Type your password');
  });
});

describe('sanitizeHeaders()', () => {
  it('removes authorization, cookie, set-cookie headers (any case)', () => {
    const out = sanitizeHeaders({
      Authorization: 'Bearer abc',
      Cookie: 'sid=1',
      'Set-Cookie': 'sid=2',
      'User-Agent': 'test',
      'X-Custom': 'ok',
    });
    expect(out).not.toHaveProperty('authorization');
    expect(out).not.toHaveProperty('cookie');
    expect(out).not.toHaveProperty('set-cookie');
    expect(out['user-agent']).toBe('test');
    expect(out['x-custom']).toBe('ok');
  });
});

describe('shouldDropRequestBody()', () => {
  it('drops body for all auth routes', () => {
    for (const route of REDACTED_BODY_ROUTES) {
      expect(shouldDropRequestBody(route)).toBe(true);
    }
  });

  it('does NOT drop body for non-auth routes', () => {
    expect(shouldDropRequestBody('/issues')).toBe(false);
    expect(shouldDropRequestBody('/workspaces/123/members')).toBe(false);
  });
});

describe('shouldSkipResponseBody()', () => {
  it('skips response body for attachment/file routes', () => {
    expect(shouldSkipResponseBody('/attachments/abc.png')).toBe(true);
    expect(shouldSkipResponseBody('/files/upload')).toBe(true);
  });

  it('does not skip for regular routes', () => {
    expect(shouldSkipResponseBody('/issues')).toBe(false);
  });
});
