#!/usr/bin/env node
/**
 * PostToolUse hook — after Edit/Write on prisma/*.prisma, remind to migrate.
 * Schema-drift footgun: edit schema → forget to migrate → prod crashes on next deploy.
 * Output to stderr (visible to Claude as a notice). Exit 0 always.
 */
let input = {};
try {
  input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
} catch { /* no stdin → exit silently */ process.exit(0); }

const file = input.tool_input?.file_path || '';

if (file.includes('prisma') && file.endsWith('.prisma')) {
  process.stderr.write(
    '⚠️  Prisma schema changed. Before next deploy:\n' +
    '   1. npx prisma migrate dev --create-only --name <descriptive>\n' +
    '   2. Review prisma/migrations/<latest>/migration.sql\n' +
    '   3. npx prisma generate\n' +
    '   4. Apply to prod via /migrate before pushing code\n' +
    '   See .claude/rules/migration-deploy.md\n'
  );
}

process.exit(0);
