/**
 * Single source of truth for the email-template schema. Both the BE
 * (MailService.renderTemplate, getTemplateOverride) and the admin FE
 * (template-schema endpoint) consume this so the placeholder list and
 * template-key list never drift.
 *
 * To add a new placeholder:
 *  1. Add it to `EMAIL_TEMPLATE_PLACEHOLDERS` below.
 *  2. Pass the matching value into the `vars` object inside `MailService`
 *     (sendVerificationEmail / sendResetPasswordEmail / future helpers).
 *  3. The admin UI picks it up automatically.
 *
 * To add a new template:
 *  1. Add a key to `EMAIL_TEMPLATE_KEYS` below.
 *  2. Add a send helper to `MailService` that calls `getTemplateOverride()`
 *     with the new key and supplies its `vars` bag.
 *  3. Add an entry to `MailTemplateTestDto.template`'s enum if the admin
 *     should be able to send a test for it.
 */

export const EMAIL_TEMPLATE_KEYS = [
  'welcome',
  'verification',
  'resetPassword',
  'oauthLinked',
  'digest',
  'invitation',
] as const;
export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

export const EMAIL_TEMPLATE_PLACEHOLDERS = [
  // Branding — always populated from `app.info`.
  'appName',
  'logoUrl',
  // Recipient identity — `recipientEmail` is always set; `recipientName`
  // falls back to email when the user has no display name yet.
  'recipientEmail',
  'recipientName',
  // OTP-aware emails (verification, resetPassword). Others render blank.
  'otp',
  'expiryMinutes',
  // Provider-aware (oauthLinked only).
  'providerLabel',
  // Digest-aware. `notificationsHtml` is pre-rendered list items (li/ul
  // emitted by the service) — admin template can wrap it in any chrome.
  'notificationsHtml',
  'notificationCount',
  'dashboardUrl',
  // Invitation-aware. `customMessage` is the admin's optional intro line
  // (HTML-escaped server-side before substitution).
  'signUpUrl',
  'customMessage',
  'inviterName',
] as const;
export type EmailTemplatePlaceholder =
  (typeof EMAIL_TEMPLATE_PLACEHOLDERS)[number];

export interface EmailTemplateSchema {
  templates: readonly EmailTemplateKey[];
  placeholders: readonly EmailTemplatePlaceholder[];
  /**
   * Sample values the admin preview should substitute for each placeholder
   * — populated server-side from the same sources MailService uses at send
   * time (`app.info`, `ENV.TOKEN_VERIFY_EXPIRY`, …) so the preview matches
   * what real recipients will see. `otp` + `recipientEmail` are static
   * sample placeholders since they're per-send, not per-tenant.
   */
  previewSample: Record<EmailTemplatePlaceholder, string>;
}
