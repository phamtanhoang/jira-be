---
description: Capture a non-obvious decision or surprising constraint from this session into .claude/memory.md so future sessions don't repeat the discovery.
---

# Learn

When you've made a decision in this session that:
- Surprised you (chose A over B for a non-obvious reason), or
- Cost time to figure out (e.g. "pooled URL fails with P1002"), or
- Future-you would benefit from knowing without re-reading the whole repo

→ append it to `.claude/memory.md`.

## Format

Append to `.claude/memory.md`:

```md
## 2026-05-28 — <topic, 3–6 words>

**Decision/finding:** <one line>

**Why:** <one line — the reasoning or evidence>

**See:** [path/to/file.ts:42](path/to/file.ts#L42) or [rule:X](.claude/rules/X.md)
```

## What to learn

✅ Save when:
- "Neon pooled URL fails for `prisma migrate` — must use direct URL with `-pooler` off"
- "Switched from per-request logging to event-driven because Neon compute hit cap in 2 days"
- "Tiptap HTML is stored raw — never re-sanitize on read or formatting is lost"
- "`@Throttle()` per-route overrides global; `@SkipThrottle()` is for read-heavy authenticated GETs only"

## What NOT to learn

❌ Don't save:
- Code patterns — just read the code
- Anything already in `CLAUDE.md` / `rules/`
- Temporary todos — use `TodoWrite`
- "How to do X in NestJS" — that's documentation, not memory
- Anything that decays in a week (current sprint, PR review status)

## After saving

If the same memory is referenced 3+ times across sessions, promote it to a rule in `.claude/rules/<name>.md` and remove from `memory.md`.

## Privacy

`memory.md` is committed to git. Don't put secrets, internal team gossip, or anything you wouldn't want in a public README.
