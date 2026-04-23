# API: Admin Settings

## Status: done (no changes needed)

## Problem
FE is adding a dedicated admin area at `/admin/settings` (see [admin-area.md](../../../jira-fe/.claude/specs/admin-area.md)) that needs to read and write the `app.info` and `app.email` settings. This spec documents the existing BE surface so FE can consume it without change.

## Surface
All routes live on `SettingsController` ([src/modules/settings/settings.controller.ts](../../src/modules/settings/settings.controller.ts)).

| Method | Path                  | Guard              | Purpose |
| ------ | --------------------- | ------------------ | ------- |
| GET    | `/settings/app-info`  | `@Public()`        | Read-only snapshot used by FE bootstrap + OG meta. Returns `{ name, logoUrl, description, authorName, authorUrl }` |
| GET    | `/settings/:key`      | `@Roles(ADMIN)`    | Read any setting by key. Returns the full `Setting` row |
| PUT    | `/settings/:key`      | `@Roles(ADMIN)`    | Upsert the setting. Body: `{ value: <JSON> }`. Value shape is key-specific (no DB schema enforcement) |

Keys currently in use (from [settings.constant.ts](../../src/core/constants/settings.constant.ts)):
- `app.info` → `{ name, logoUrl, description, authorName, authorUrl }`
- `app.email` → `{ email }` (FROM address used by `MailService`)

## Why no BE change
- Role gate already in place: `@Roles(Role.ADMIN)` on GET/PUT by key.
- JSON `value` column accepts arbitrary shape — adding new keys later is a pure FE change.
- `MailService` already reads `app.email` from `Setting` via `getSetting(SETTING_KEYS.APP_EMAIL)` — changes made from the admin UI take effect on the next email send (no restart required).

## Validation (out of scope — FE responsibility)
- FE must use zod schemas (`appInfoSchema`, `appEmailSchema`) before PUT so invalid payloads never leave the browser.
- BE's `SetSettingDto` only asserts `IsNotEmpty` on `value` — shape validation is intentionally loose so settings can evolve without migrations.

## Security
- Writes require `ADMIN` role (enforced server-side — FE layout gating is UX only).
- `app.info` is safe to expose publicly via `GET /settings/app-info` — it's branding metadata.
- `app.email` is NOT exposed publicly — only `GET /settings/:key` (admin-only) returns it.
- `Setting.value` is logged with the normal request-logging pipeline; no additional redaction needed (no secrets are stored here).

## Future extensions (tracked, not implemented)
- `app.features` — runtime feature flags (JSON map).
- `app.smtp` — if/when we move off Resend. Will require adding `password`/`apiKey` field names to `SENSITIVE_KEYS` in [sanitize.util.ts](../../src/core/utils/sanitize.util.ts).
