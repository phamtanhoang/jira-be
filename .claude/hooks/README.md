# Hooks

Trigger-based automations wired into Claude Code via `.claude/settings.json`.

All hooks here follow three rules:
1. **Exit 0 always** — never block tool execution.
2. **Fast** — < 200ms for blocking hooks; async + timeout for anything heavier.
3. **Advisory only** — output to stderr/stdout, don't side-effect files.

## Active hooks

| ID | Event | Trigger | Purpose |
|---|---|---|---|
| `session-start` | `SessionStart` | New session | Print branch + recent commits + latest migrations |
| `post-edit-prisma` | `PostToolUse` | Edit/Write on `prisma/*.prisma` | Remind to run `migrate dev` |
| `post-edit-sensitive` | `PostToolUse` | Edit/Write on `*.dto.ts` with sensitive-looking field | Remind to update `SENSITIVE_KEYS` |

## Disable selectively

Set env var to disable specific hooks:

```powershell
$env:JIRA_BE_DISABLED_HOOKS = "post-edit-sensitive"
```

(Hooks read this themselves; the settings.json wiring stays static.)

## Adding a new hook

1. Write `<name>.js` in this folder. Stdin gets `{ tool_input, tool_name, ... }` as JSON.
2. Append entry to `.claude/settings.json` `hooks` block with matcher + path.
3. Document in the table above.
4. Always `process.exit(0)` — even on error.
