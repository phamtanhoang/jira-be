// Single source of truth for environment-variable access in the backend.
// All other modules MUST import from `@/core/constants` (which re-exports
// this `ENV`) and never read `process.env.*` directly. Defaults / required
// markers live here and only here — callers stay declarative.

const NODE_ENV = process.env.NODE_ENV ?? 'development';

export const ENV = {
  // ─── Required at boot — server fails loudly if missing ────────────────
  DATABASE_URL: process.env.DATABASE_URL!,
  PORT: process.env.PORT ?? '4000',
  JWT_SECRET: process.env.JWT_SECRET!,
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  NODE_ENV,
  RESEND_API_KEY: process.env.RESEND_API_KEY ?? '',
  SUPABASE_URL: process.env.SUPABASE_URL ?? '',
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY ?? '',
  SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET ?? '',

  // ─── Numeric (with sensible defaults) ─────────────────────────────────
  TOKEN_VERIFY_EXPIRY: parseInt(process.env.TOKEN_VERIFY_EXPIRY ?? '900'),
  JWT_ACCESS_TOKEN_EXPIRATION: parseInt(
    process.env.JWT_ACCESS_TOKEN_EXPIRATION ?? '900',
  ),
  JWT_REFRESH_TOKEN_EXPIRATION: parseInt(
    process.env.JWT_REFRESH_TOKEN_EXPIRATION ?? '604800',
  ),
  // 30 days, in seconds — matches `prisma migrate dev`'s default for OTP.
  LOG_RETENTION_EXPIRY: parseInt(process.env.LOG_RETENTION_EXPIRY ?? '2592000'),

  // ─── Mail ─────────────────────────────────────────────────────────────
  // Fallback FROM address when admin hasn't filled the `app.email` setting in
  // DB. Resend rejects sends with an empty `from`, so this prevents the whole
  // signup / forgot-password flow from breaking just because settings were
  // never configured. Format: bare email or "Display Name <addr@domain>".
  MAIL_FROM: process.env.MAIL_FROM ?? '',
  MAIL_FROM_NAME: process.env.MAIL_FROM_NAME ?? '',

  // ─── Sentry ───────────────────────────────────────────────────────────
  SENTRY_DSN: process.env.SENTRY_DSN ?? '',
  SENTRY_ENV: process.env.SENTRY_ENV ?? NODE_ENV,

  // ─── OAuth ────────────────────────────────────────────────────────────
  // When *_CLIENT_ID is empty the corresponding strategy stays dormant: the
  // route is still registered but Passport rejects auth attempts. Lets the
  // app boot even before secrets are provisioned.
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? '',
  GOOGLE_CALLBACK_URL:
    process.env.GOOGLE_CALLBACK_URL ??
    'http://localhost:4000/auth/google/callback',
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID ?? '',
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET ?? '',
  GITHUB_CALLBACK_URL:
    process.env.GITHUB_CALLBACK_URL ??
    'http://localhost:4000/auth/github/callback',

  // Where the BE redirects the user after a successful OAuth callback.
  // Defaults to the first CORS_ORIGIN entry if unset.
  FRONTEND_URL: process.env.FRONTEND_URL ?? '',

  // ─── Web Push (VAPID) ────────────────────────────────────
  // When VAPID_PUBLIC_KEY is empty, push module stays dormant — endpoints
  // 503 instead of failing silently. Subject must be `mailto:` or https URL.
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY ?? '',
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY ?? '',
  VAPID_SUBJECT: process.env.VAPID_SUBJECT ?? '',

  // ─── Derived flags — single place we compare NODE_ENV ─────────────────
  IS_PRODUCTION: NODE_ENV === 'production',
  IS_DEVELOPMENT: NODE_ENV === 'development',
  IS_TEST: NODE_ENV === 'test',
} as const;
