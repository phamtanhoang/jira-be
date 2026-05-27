# Admin Settings Toggles

The `Setting` table is a key-value JSON store used for runtime-tunable config that admins can change without redeploy.

## Existing keys (`SETTING_KEYS` in `src/core/constants/settings.constant.ts`)

| Key | Shape | Audience | Edited by |
|---|---|---|---|
| `app.info` | `{ name, logoUrl, description, authorName, authorUrl }` | Public — FE reads on every page load | `/admin/settings` → App Info |
| `app.email` | `{ provider, fromEmail, fromName, smtp?: {...} }` | Admin-only — SMTP password redacted on GET | `/admin/settings` → Email |
| `app.email_templates` | `{ verification, resetPassword, welcome }` | Admin-only | `/admin/settings` → Email Templates |
| `app.features` | `{ [flag]: boolean }` | Read by FE for flag-gated UI | `/admin/flags` |
| `app.announcement` | `{ enabled, message, severity }` | Public — banner shown to all | `/admin/announcement` |
| `app.maintenance` | `{ enabled, message, allowedEmails[] }` | Public — FE middleware gates routes | `/admin/settings` → Maintenance |
| `app.auth_providers` | `{ password, google, github }` | Public — drives sign-in button visibility | `/admin/settings` → Auth |
| `app.quotas` | `{ maxProjectsPerWorkspace, maxMembersPerWorkspace, maxStorageGB }` | Internal enforcement | `/admin/settings` → Quotas |
| `app.logging_config` | `{ enabled, requestLog, adminAudit, mailLog, webhookDelivery }` | Internal kill switches | `/admin/logs` → Logging popover |

## Snapshot pattern (`LoggingConfigService`)

For settings consumed on the hot path (every request), reading from DB synchronously is too slow. Pattern:

1. Service holds `private snapshot: LoggingConfig` as in-memory state.
2. `OnModuleInit` → `refresh()` from DB.
3. `@Cron` periodic refresh (every 5 min — 1 hour depending on staleness budget).
4. `SettingsService.setByKey` → calls `loggingConfig.refresh()` immediately after upsert so admin sees effect <1s.
5. Consumers read snapshot synchronously via `isEnabled(channel)`.

Apply the same pattern when adding new hot-path settings — DO NOT query DB inside an interceptor / filter / per-request middleware.

## Adding a new setting key

1. Add to `SETTING_KEYS` const.
2. Add typed accessor on `SettingsService` (e.g. `getXxxConfig(): Promise<XxxConfig>`) with default fallback for fresh installs.
3. (If hot-path) Create `XxxConfigService` with snapshot pattern + `LoggingConfigModule`-style `@Global` module.
4. Update `prisma/seed.ts` SEED dictionary so fresh installs get sensible defaults.
5. FE: add to `SETTING_KEYS` in `jira-fe/src/features/admin/types.ts` + new type for the value.
6. FE: add admin UI form to edit it (probably in `/admin/settings/*`).

## Defaults must work without the row

A fresh install has no row in `Setting` table. Service accessors MUST default to a sensible value:

```ts
async getQuotas() {
  const setting = await this.prisma.setting.findUnique({ where: { key: SETTING_KEYS.APP_QUOTAS } });
  const value = (setting?.value ?? {}) as Partial<QuotasValue>;
  return {
    maxProjectsPerWorkspace: value.maxProjectsPerWorkspace ?? 0, // 0 = unlimited
    // ...
  };
}
```

For `getByKey()`: when key is hot-path but row missing → return defaults object instead of 404 (so admin form renders without error). See `SettingsService.getByKey` fallback for `APP_LOGGING_CONFIG`.

## Audit + cache invalidation on write

`setByKey` MUST:
1. Audit-log the change via `this.audit.log(actorId, 'SETTING_UPDATE', ...)`.
2. Invalidate the `'settings'` cache tag: `void this.cacheTags.invalidateTag('settings');`.
3. For email config: invalidate the MailService transporter (`this.mail.invalidateTransport()`).
4. For logging config: refresh the snapshot (`void this.loggingConfig.refresh()`).
5. For app-info: bust FE ISR tag (FE `bustSSRTag('public-app-info')`) — done FE-side after PUT.

## Things easy to get wrong

- ❌ Querying `Setting` table from interceptor / per-request code path — slow + N+1. Use snapshot pattern instead.
- ❌ Returning the raw setting row when it contains secrets (SMTP password). Redact in `getByKey` like `redactAppEmail()` does.
- ❌ Forgetting cache invalidation. UI changes but the next page load shows the stale value because `wrap()` keeps the old result.
