/**
 * Recursive payload sanitizer for request/response logging.
 *
 * Masks values whose key matches a sensitive-field allowlist (case-insensitive,
 * underscores/dashes normalized). Caps recursion depth and size to keep logs
 * bounded even on hostile or self-referential input.
 */

const SENSITIVE_KEYS = new Set([
  'password',
  'newpassword',
  'oldpassword',
  'currentpassword',
  'confirmpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'apikey',
  'otp',
  'secret',
  'clientsecret',
  'authorization',
  'cookie',
  'setcookie',
  'creditcard',
  'cvv',
  'ssn',
]);

const MASK = '***';
const MAX_DEPTH = 10;
const MAX_BYTES = 32_000;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(normalizeKey(key));
}

/**
 * Route paths (prefix match) whose request body MUST be dropped entirely,
 * regardless of field-level sanitization. Double-safety for auth endpoints.
 */
export const REDACTED_BODY_ROUTES = [
  '/auth/login',
  '/auth/register',
  '/auth/reset-password',
  '/auth/verify-email',
  '/auth/forgot-password',
];

export function shouldDropRequestBody(url: string): boolean {
  return REDACTED_BODY_ROUTES.some((route) => url.startsWith(route));
}

/**
 * Routes whose response body should NOT be logged (binary / large payloads).
 */
export const SKIP_RESPONSE_BODY_ROUTES = ['/attachments', '/files'];

export function shouldSkipResponseBody(url: string): boolean {
  return SKIP_RESPONSE_BODY_ROUTES.some((route) => url.startsWith(route));
}

/**
 * Noisy routes — every FE tab polls these every few seconds. Logging them
 * floods the RequestLog table and drowns out genuinely interesting traffic.
 * Skipped ONLY for successful (2xx/3xx) GET responses; any 4xx/5xx still logs
 * (errors are always worth keeping).
 *
 * Maintain this list carefully: new polling endpoints should be added here.
 * Business-meaningful reads (GET /issues, /workspaces, /users ...) stay
 * logged so admins can audit what was viewed.
 */
export const LOG_SKIP_GET_ROUTES = [
  '/auth/me',
  '/auth/refresh',
  '/settings/app-info',
  '/settings/app-announcement',
  '/settings/app-maintenance',
  '/admin/stats',
  '/admin/analytics',
  '/admin/metrics',
  '/logs/client',
];

export function shouldSkipLogging(
  method: string,
  url: string,
  statusCode: number,
): boolean {
  // Always log failures — they are the whole point of logging.
  if (statusCode >= 400) return false;
  if (method.toUpperCase() !== 'GET') return false;
  return LOG_SKIP_GET_ROUTES.some((route) => url.startsWith(route));
}

/**
 * Strip sensitive HTTP headers before persistence.
 * Returns a shallow-cloned, lowercased-keys object with masked entries.
 */
export function sanitizeHeaders(
  headers: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (
      lower === 'authorization' ||
      lower === 'cookie' ||
      lower === 'set-cookie'
    ) {
      continue;
    }
    out[lower] = value;
  }
  return out;
}

/**
 * Recursively sanitize a payload:
 *  - Mask values under sensitive keys
 *  - Cap depth and detect cycles
 *  - Truncate if the serialized size exceeds MAX_BYTES
 */
export function sanitize(value: unknown): unknown {
  const seen = new WeakSet<object>();
  const result = walk(value, 0, seen);
  return enforceSizeLimit(result);
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return '[MaxDepth]';

  if (typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => walk(item, depth + 1, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      out[key] = MASK;
    } else {
      out[key] = walk(v, depth + 1, seen);
    }
  }
  return out;
}

function enforceSizeLimit(value: unknown): unknown {
  try {
    const json = JSON.stringify(value);
    if (!json) return value;
    if (json.length <= MAX_BYTES) return value;
    return { _truncated: true, size: json.length };
  } catch {
    return { _truncated: true, reason: 'serialization-failed' };
  }
}
