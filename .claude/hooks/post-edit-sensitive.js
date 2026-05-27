#!/usr/bin/env node
/**
 * PostToolUse hook — after Edit/Write on DTOs, remind to sync SENSITIVE_KEYS.
 * Pattern bug: adding a sensitive field (password, token, otp) to a DTO without
 * adding its name to SENSITIVE_KEYS leaks plaintext into RequestLog.
 */
let input = {};
try {
  input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
} catch { process.exit(0); }

const file = input.tool_input?.file_path || '';
const newContent = input.tool_input?.new_string || input.tool_input?.content || '';

if (!file.endsWith('.dto.ts')) process.exit(0);

const SENSITIVE_HINTS = /\b(password|otp|token|secret|apiKey|api_key|privateKey|private_key|refreshToken|accessToken|sessionToken|creditCard|ssn)\b/i;

if (SENSITIVE_HINTS.test(newContent)) {
  process.stderr.write(
    '⚠️  DTO touches a sensitive-looking field. Ensure its key name is in:\n' +
    '   src/core/utils/sanitize.util.ts → SENSITIVE_KEYS\n' +
    '   Otherwise it leaks in plaintext to RequestLog.\n' +
    '   See .claude/rules/logging.md\n'
  );
}

process.exit(0);
