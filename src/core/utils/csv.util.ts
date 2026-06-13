/**
 * CSV cell escape per RFC 4180, with formula-injection mitigation.
 *
 * Wraps the field in double quotes when it contains a delimiter (`,`),
 * quote (`"`), CR or LF, and doubles every embedded quote. Primitives
 * stringify cleanly; objects fall back to JSON to avoid the
 * `[object Object]` trap that the default `String()` would produce.
 *
 * Cells that start with `=`, `+`, `-`, `@`, tab or CR are prefixed with
 * a single quote so spreadsheet apps don't interpret them as formulas
 * — opening a CSV with `=cmd|'/c calc'!A1` would otherwise execute on
 * vulnerable Excel installs.
 */
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r']);

export function csvEscape(value: unknown): string {
  if (value == null) return '';
  let s: string;
  // Only string inputs get the formula-injection prefix — numeric /
  // boolean / bigint values are spreadsheet-safe by construction (their
  // stringified form is just digits/`true`/`false`), and prefixing
  // `-1.5` → `'-1.5` would break legitimate numeric exports.
  let allowFormulaGuard = false;
  if (typeof value === 'string') {
    s = value;
    allowFormulaGuard = true;
  } else if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    s = value.toString();
  } else {
    s = JSON.stringify(value);
  }
  if (allowFormulaGuard && s.length > 0 && FORMULA_TRIGGERS.has(s[0])) {
    s = `'${s}`;
  }
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
