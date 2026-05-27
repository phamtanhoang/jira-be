#!/usr/bin/env node
/**
 * SessionStart hook — print orientation so Claude doesn't need to ask.
 * Output goes to stdout → injected as additional context at session start.
 * Exit 0 always (never block).
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function safe(cmd, fallback = '') {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 2000,
    }).trim();
  } catch {
    return fallback;
  }
}

function tryRead(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

const branch = safe('git rev-parse --abbrev-ref HEAD', 'no-git');
const dirty = safe('git status --short');
const lastCommits = safe('git log --oneline -5');
const migrations = safe('ls prisma/migrations 2>/dev/null')
  .split('\n')
  .filter(Boolean)
  .slice(-3);

const out = ['## jira-be session context', ''];
out.push(`- branch: \`${branch}\``);
if (dirty) {
  const lines = dirty.split('\n').length;
  out.push(`- uncommitted: ${lines} file(s)`);
}
if (lastCommits) {
  out.push('- recent commits:');
  lastCommits.split('\n').forEach((l) => out.push(`  - ${l}`));
}
if (migrations.length) {
  out.push('- latest migrations:');
  migrations.forEach((m) => out.push(`  - ${m}`));
}
out.push('');
out.push('Start by reading `.claude/ONBOARDING.md` if this is a new session.');
out.push('Skill hints + rule index live in `.claude/CLAUDE.md` and `.claude/RULES_INDEX.md`.');

process.stdout.write(out.join('\n') + '\n');
process.exit(0);
