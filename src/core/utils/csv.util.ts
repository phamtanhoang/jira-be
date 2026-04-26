/**
 * CSV cell escape per RFC 4180.
 *
 * Wraps the field in double quotes when it contains a delimiter (`,`),
 * quote (`"`), CR or LF, and doubles every embedded quote. Primitives
 * stringify cleanly; objects fall back to JSON to avoid the
 * `[object Object]` trap that the default `String()` would produce.
 */
export function csvEscape(value: unknown): string {
  if (value == null) return '';
  let s: string;
  if (typeof value === 'string') {
    s = value;
  } else if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    s = value.toString();
  } else {
    s = JSON.stringify(value);
  }
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
