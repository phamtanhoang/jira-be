export const ENV = {
  DATABASE_URL: process.env.DATABASE_URL!,
  PORT: process.env.PORT!,
  JWT_SECRET: process.env.JWT_SECRET!,
  TOKEN_VERIFY_EXPIRY: parseInt(process.env.TOKEN_VERIFY_EXPIRY!),
  JWT_ACCESS_TOKEN_EXPIRATION: parseInt(
    process.env.JWT_ACCESS_TOKEN_EXPIRATION!,
  ),
  JWT_REFRESH_TOKEN_EXPIRATION: parseInt(
    process.env.JWT_REFRESH_TOKEN_EXPIRATION!,
  ),
  CORS_ORIGIN: process.env.CORS_ORIGIN!,
  NODE_ENV: process.env.NODE_ENV!,
  RESEND_API_KEY: process.env.RESEND_API_KEY!,
  // Fallback FROM address when admin hasn't filled the `app.email` setting in
  // DB. Resend rejects sends with an empty `from`, so this prevents the whole
  // signup / forgot-password flow from breaking just because settings were
  // never configured. Format: bare email or "Display Name <addr@domain>".
  MAIL_FROM: process.env.MAIL_FROM ?? '',
  MAIL_FROM_NAME: process.env.MAIL_FROM_NAME ?? '',
  SUPABASE_URL: process.env.SUPABASE_URL!,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY!,
  SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET!,
  SENTRY_DSN: process.env.SENTRY_DSN!,
  SENTRY_ENV: process.env.SENTRY_ENV!,
  LOG_RETENTION_EXPIRY: parseInt(process.env.LOG_RETENTION_EXPIRY!),
} as const;
