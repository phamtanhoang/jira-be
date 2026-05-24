export const SETTING_KEYS = {
  APP_INFO: 'app.info',
  APP_EMAIL: 'app.email',
  APP_FEATURES: 'app.features',
  APP_ANNOUNCEMENT: 'app.announcement',
  APP_MAINTENANCE: 'app.maintenance',
  APP_AUTH_PROVIDERS: 'app.auth_providers',
  APP_QUOTAS: 'app.quotas',
  APP_EMAIL_TEMPLATES: 'app.email_templates',
  /**
   * Per-channel logging on/off switches. Admins use this to stop writing
   * cheap-to-track-but-cheap-to-lose log rows during learning/testing on
   * a small Neon free-tier database. Stored shape:
   *   `{ enabled, requestLog, adminAudit, mailLog, webhookDelivery }`
   * `enabled=false` short-circuits everything (master kill switch).
   */
  APP_LOGGING_CONFIG: 'app.logging_config',
} as const;
