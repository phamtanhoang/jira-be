import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { MailType } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { Resend } from 'resend';
import { ENV, MSG, SETTING_KEYS } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { SentryService } from '@/core/services/sentry.service';
import { MailLogService } from './mail-log.service';
import {
  EMAIL_TEMPLATE_KEYS,
  EMAIL_TEMPLATE_PLACEHOLDERS,
  type EmailTemplateKey,
  type EmailTemplatePlaceholder,
  type EmailTemplateSchema,
} from './mail-template.schema';
import { otpEmailTemplate } from './templates/otp-email.template';

export type MailProvider = 'resend' | 'smtp';

/**
 * Persisted shape of the `app.email` setting. SMTP is the operator-friendly
 * path: admin pastes their own host/port/user/password and every send goes
 * through their account. Resend is the zero-setup fallback.
 *
 * `smtp.password` is NEVER returned by the public settings endpoint — see
 * `redactAppEmail()` in settings.service.ts.
 */
export interface AppEmailSettings {
  provider?: MailProvider;
  fromEmail?: string;
  fromName?: string;
  smtp?: {
    host?: string;
    port?: number;
    secure?: boolean;
    user?: string;
    password?: string;
  };
  // Legacy single-field shape — kept readable so old settings still work
  // until admin re-saves the form.
  email?: string;
}

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  type: MailType;
}

interface SendResult {
  providerId: string | null;
}

export interface MailConfigStatus {
  configured: boolean;
  provider: MailProvider;
  fromEmail: string | null;
  missing: string[];
}

@Injectable()
export class MailService {
  private readonly resend = new Resend(ENV.RESEND_API_KEY);
  private readonly logger = new Logger(MailService.name);
  private smtpCache: {
    key: string;
    transporter: Transporter;
  } | null = null;

  constructor(
    private prisma: PrismaService,
    private mailLog: MailLogService,
    private sentry: SentryService,
  ) {}

  private async getAppInfo(): Promise<Record<string, string>> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEYS.APP_INFO },
    });
    return (setting?.value as Record<string, string>) ?? {};
  }

  async getAppEmail(): Promise<AppEmailSettings> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEYS.APP_EMAIL },
    });
    return (setting?.value as AppEmailSettings) ?? {};
  }

  /**
   * Compute which fields are missing for the configured provider so the admin
   * UI can surface a "fix this before sending" warning instead of letting
   * registers fail silently.
   */
  async getConfigStatus(): Promise<MailConfigStatus> {
    const cfg = await this.getAppEmail();
    const provider: MailProvider = cfg.provider ?? 'resend';
    const fromEmail = (cfg.fromEmail || cfg.email || ENV.MAIL_FROM).trim();
    const missing: string[] = [];

    if (!fromEmail) missing.push('fromEmail');

    if (provider === 'smtp') {
      if (!cfg.smtp?.host) missing.push('smtp.host');
      if (!cfg.smtp?.port) missing.push('smtp.port');
      if (!cfg.smtp?.user) missing.push('smtp.user');
      if (!cfg.smtp?.password) missing.push('smtp.password');
    } else if (!ENV.RESEND_API_KEY) {
      missing.push('RESEND_API_KEY');
    }

    return {
      configured: missing.length === 0,
      provider,
      fromEmail: fromEmail || null,
      missing,
    };
  }

  /** Resolve "Display Name <addr@x>" for the FROM header. */
  private async resolveFromHeader(
    cfg: AppEmailSettings,
  ): Promise<{ from: string; email: string }> {
    const appInfo = await this.getAppInfo();
    const email = (cfg.fromEmail || cfg.email || ENV.MAIL_FROM).trim();
    if (!email) {
      throw new InternalServerErrorException(MSG.ERROR.MAIL_NOT_CONFIGURED);
    }
    const name =
      cfg.fromName?.trim() || appInfo.name?.trim() || ENV.MAIL_FROM_NAME.trim();
    return {
      from: name ? `${name} <${email}>` : email,
      email,
    };
  }

  /**
   * Memoise the Nodemailer transporter keyed on the SMTP credentials hash.
   * Recreating the connection pool per request would be slow + log-noisy;
   * cache invalidates when any field changes.
   */
  private getSmtpTransporter(cfg: AppEmailSettings['smtp']): Transporter {
    const key = `${cfg?.host}:${cfg?.port}:${cfg?.secure}:${cfg?.user}:${cfg?.password}`;
    if (this.smtpCache?.key === key) return this.smtpCache.transporter;
    const transporter = nodemailer.createTransport({
      host: cfg?.host,
      port: Number(cfg?.port),
      secure: !!cfg?.secure,
      auth: { user: cfg?.user, pass: cfg?.password },
    });
    this.smtpCache = { key, transporter };
    return transporter;
  }

  async send({ to, subject, html, type }: SendArgs): Promise<SendResult> {
    let fromEmail: string | null = null;
    try {
      const cfg = await this.getAppEmail();
      const status = await this.getConfigStatus();
      if (!status.configured) {
        throw new Error(
          `Mail not configured. Missing: ${status.missing.join(', ')}`,
        );
      }
      const provider = status.provider;
      const { from, email } = await this.resolveFromHeader(cfg);
      fromEmail = email;

      const providerId = await (provider === 'smtp'
        ? this.sendViaSmtp({ cfg, from, to, subject, html })
        : this.sendViaResend({ from, to, subject, html }));

      this.logger.log(
        `Sent "${subject}" to ${to} via ${provider} (${providerId ?? '?'})`,
      );
      this.mailLog.recordSent({
        type,
        recipient: to,
        subject,
        fromEmail,
        providerId: providerId ?? null,
      });
      return { providerId: providerId ?? null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Mail to ${to} failed: ${message}`);
      const sentryId = this.sentry.captureException(err, {
        extra: { recipient: to, subject, type, fromEmail },
      });
      this.mailLog.recordFailed({
        type,
        recipient: to,
        subject,
        fromEmail,
        errorMessage: message,
        sentryId: sentryId ?? null,
      });
      throw new InternalServerErrorException(MSG.ERROR.MAIL_SEND_FAILED);
    }
  }

  private async sendViaResend(args: {
    from: string;
    to: string;
    subject: string;
    html: string;
  }): Promise<string | null> {
    const result = await this.resend.emails.send({
      from: args.from,
      to: args.to,
      subject: args.subject,
      html: args.html,
    });
    if (result.error) {
      throw new Error(`[Resend] ${result.error.name}: ${result.error.message}`);
    }
    return result.data?.id ?? null;
  }

  private async sendViaSmtp(args: {
    cfg: AppEmailSettings;
    from: string;
    to: string;
    subject: string;
    html: string;
  }): Promise<string | null> {
    const transporter = this.getSmtpTransporter(args.cfg.smtp);
    // Nodemailer's `SentMessageInfo` is typed as `any` in @types/nodemailer;
    // assign to `unknown` and probe the shape we actually care about so the
    // no-unsafe-* lints stay clean and we never propagate `any` outward.
    const info: unknown = await transporter.sendMail({
      from: args.from,
      to: args.to,
      subject: args.subject,
      html: args.html,
    });
    if (info && typeof info === 'object' && 'messageId' in info) {
      const id = (info as { messageId: unknown }).messageId;
      if (typeof id === 'string') return id;
    }
    return null;
  }

  /**
   * Re-create the cached SMTP transporter on next send. Called by the
   * settings controller after any update to `app.email` so a credential
   * change takes effect without a full server restart.
   */
  invalidateTransport() {
    this.smtpCache = null;
  }

  /**
   * Resolve admin-overridden subject + html for a template key. Returns null
   * fields when the admin has not configured anything for this template, so
   * callers can fall back to the built-in default.
   */
  /**
   * Schema the admin editor uses: list of template keys, placeholders, and
   * a `previewSample` resolved from the same sources real send-time vars
   * use (`app.info` + `ENV.TOKEN_VERIFY_EXPIRY`). The FE renders this in
   * its preview iframe so the admin sees the actual brand name / logo
   * instead of made-up dummies.
   */
  async getTemplateSchema(): Promise<EmailTemplateSchema> {
    const appInfo = await this.getAppInfo();
    const expiryMinutes = Math.round(ENV.TOKEN_VERIFY_EXPIRY / 60);
    const dashboardUrl = resolveDashboardUrl();
    const sampleSignUpUrl = `${resolveFrontendBase()}/sign-up?email=alice%40example.com`;
    const sampleItem = `<li style="padding:10px 0;border-bottom:1px solid #e5e7eb"><div style="font-weight:500">Sample notification</div></li>`;
    return {
      templates: EMAIL_TEMPLATE_KEYS,
      placeholders: EMAIL_TEMPLATE_PLACEHOLDERS,
      // Each value is a placeholder-aware sample: the FE preview iframe
      // shows what the recipient WILL see for each variable, instead of
      // raw `{{placeholder}}` strings. Per-send values (OTP, recipient,
      // notifications) get clearly-fake samples so admins can't mistake
      // the preview for leaked production data.
      previewSample: {
        appName: appInfo.name ?? '',
        logoUrl: appInfo.logoUrl ?? '',
        otp: '123456',
        expiryMinutes: String(expiryMinutes),
        recipientEmail: 'alice@example.com',
        recipientName: 'Alice',
        providerLabel: 'Google',
        notificationsHtml: sampleItem,
        notificationCount: '1',
        dashboardUrl,
        signUpUrl: sampleSignUpUrl,
        customMessage: 'Welcome to the team!',
        inviterName: 'Admin',
      },
    };
  }

  private async getTemplateOverride(
    name: EmailTemplateKey,
  ): Promise<{ subject: string | null; html: string | null }> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEYS.APP_EMAIL_TEMPLATES },
    });
    const value = (setting?.value ?? {}) as Record<
      string,
      { subject?: string; html?: string } | undefined
    >;
    const tpl = value[name] ?? {};
    return {
      subject: tpl.subject?.trim() || null,
      html: tpl.html?.trim() || null,
    };
  }

  /**
   * Substitute `{{var}}` tokens in admin-supplied HTML. Tokens are limited to
   * the small set we know is safe to expose — `appName`, `logoUrl`, `otp`,
   * `expiryMinutes`, `recipientEmail`. Unknown placeholders are left intact.
   */
  private renderTemplate(
    template: string,
    vars: Record<string, string | number>,
  ): string {
    return template.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (match, key) => {
      const v = vars[key as string];
      return v === undefined || v === null ? match : String(v);
    });
  }

  async sendVerificationEmail(email: string, otp: string): Promise<void> {
    const appInfo = await this.getAppInfo();
    const override = await this.getTemplateOverride('verification');
    const expiryMinutes = Math.round(ENV.TOKEN_VERIFY_EXPIRY / 60);
    const vars = {
      ...emptyPlaceholders(),
      appName: appInfo.name ?? '',
      logoUrl: appInfo.logoUrl ?? '',
      otp,
      expiryMinutes,
      recipientEmail: email,
      recipientName: '',
    };
    await this.send({
      to: email,
      subject: override.subject
        ? this.renderTemplate(override.subject, vars)
        : 'Verify your email',
      html: override.html
        ? this.renderTemplate(override.html, vars)
        : otpEmailTemplate({
            appName: vars.appName,
            logoUrl: vars.logoUrl,
            otp,
            expirySeconds: ENV.TOKEN_VERIFY_EXPIRY,
            title: 'Verify your email',
            description: 'Enter the code below to verify your email address.',
          }),
      type: MailType.VERIFICATION,
    });
  }

  async sendResetPasswordEmail(email: string, otp: string): Promise<void> {
    const appInfo = await this.getAppInfo();
    const override = await this.getTemplateOverride('resetPassword');
    const expiryMinutes = Math.round(ENV.TOKEN_VERIFY_EXPIRY / 60);
    const vars = {
      ...emptyPlaceholders(),
      appName: appInfo.name ?? '',
      logoUrl: appInfo.logoUrl ?? '',
      otp,
      expiryMinutes,
      recipientEmail: email,
    };
    await this.send({
      to: email,
      subject: override.subject
        ? this.renderTemplate(override.subject, vars)
        : 'Reset your password',
      html: override.html
        ? this.renderTemplate(override.html, vars)
        : otpEmailTemplate({
            appName: vars.appName,
            logoUrl: vars.logoUrl,
            otp,
            expirySeconds: ENV.TOKEN_VERIFY_EXPIRY,
            title: 'Reset your password',
            description: 'Enter the code below to reset your password.',
          }),
      type: MailType.PASSWORD_RESET,
    });
  }

  /**
   * Fires when a new OAuth provider is linked to a user's account — first
   * sign-in via Google or GitHub, or when an admin endpoint adds a fresh
   * link. Mirrors the pattern Google / GitHub / Slack use to surface "a
   * new sign-in method was attached" so the rightful owner can react if
   * they didn't do it themselves.
   */
  async sendOAuthLinkedEmail(
    email: string,
    provider: 'google' | 'github',
  ): Promise<void> {
    const appInfo = await this.getAppInfo();
    const override = await this.getTemplateOverride('oauthLinked');
    const providerLabel = provider === 'google' ? 'Google' : 'GitHub';
    const vars = {
      ...emptyPlaceholders(),
      appName: appInfo.name ?? '',
      logoUrl: appInfo.logoUrl ?? '',
      recipientEmail: email,
      providerLabel,
    };
    await this.send({
      to: email,
      subject: override.subject
        ? this.renderTemplate(override.subject, vars)
        : `${providerLabel} sign-in linked to your ${vars.appName || 'account'}`,
      html: override.html
        ? this.renderTemplate(override.html, vars)
        : oauthLinkedFallbackHtml({
            appName: vars.appName || 'Jira Clone',
            providerLabel,
            recipientEmail: email,
          }),
      type: MailType.OTHER,
    });
  }

  /**
   * Fires once per user, right after they successfully verify their email.
   * No OTP or expiry — `otp` / `expiryMinutes` are passed empty so any
   * `{{otp}}` left in an admin-edited template renders as blank rather than
   * leaking a sample code.
   *
   * MailType is `OTHER` until the enum grows a `WELCOME` value (avoiding an
   * enum migration during the current stabilization phase).
   */
  async sendWelcomeEmail(email: string): Promise<void> {
    const appInfo = await this.getAppInfo();
    const override = await this.getTemplateOverride('welcome');
    const vars = {
      ...emptyPlaceholders(),
      appName: appInfo.name ?? '',
      logoUrl: appInfo.logoUrl ?? '',
      recipientEmail: email,
      dashboardUrl: resolveDashboardUrl(),
    };
    await this.send({
      to: email,
      subject: override.subject
        ? this.renderTemplate(override.subject, vars)
        : `Welcome to ${vars.appName || 'Jira Clone'}!`,
      html: override.html
        ? this.renderTemplate(override.html, vars)
        : welcomeFallbackHtml(vars),
      type: MailType.OTHER,
    });
  }

  /**
   * Daily digest of unread notifications. Caller pre-renders the inner
   * list (one `<li>` per row) and passes it as `notificationsHtml` —
   * admin template wraps it in whatever chrome they want. We do NOT
   * delegate row rendering to the admin template: list shape depends on
   * runtime data, so it's safer to keep the layout in code and let the
   * admin own only the surrounding HTML.
   */
  async sendDigestEmail(args: {
    to: string;
    recipientName: string | null;
    notificationsHtml: string;
    notificationCount: number;
  }): Promise<void> {
    const appInfo = await this.getAppInfo();
    const override = await this.getTemplateOverride('digest');
    const vars = {
      ...emptyPlaceholders(),
      appName: appInfo.name ?? '',
      logoUrl: appInfo.logoUrl ?? '',
      recipientEmail: args.to,
      recipientName: args.recipientName || args.to,
      notificationsHtml: args.notificationsHtml,
      notificationCount: String(args.notificationCount),
      dashboardUrl: resolveDashboardUrl(),
    };
    const fallbackSubject = `You have ${args.notificationCount} unread notification${args.notificationCount === 1 ? '' : 's'}`;
    await this.send({
      to: args.to,
      subject: override.subject
        ? this.renderTemplate(override.subject, vars)
        : fallbackSubject,
      html: override.html
        ? this.renderTemplate(override.html, vars)
        : digestFallbackHtml(vars),
      type: MailType.OTHER,
    });
  }

  /**
   * User invitation. Admin's free-form `customMessage` is HTML-escaped
   * before substitution so a typo in the message can't break template
   * rendering. The template owns the surrounding chrome + CTA button.
   */
  async sendInvitationEmail(args: {
    to: string;
    signUpUrl: string;
    customMessage?: string;
    inviterName?: string | null;
  }): Promise<void> {
    const appInfo = await this.getAppInfo();
    const override = await this.getTemplateOverride('invitation');
    const vars = {
      ...emptyPlaceholders(),
      appName: appInfo.name ?? '',
      logoUrl: appInfo.logoUrl ?? '',
      recipientEmail: args.to,
      signUpUrl: args.signUpUrl,
      customMessage: args.customMessage ? escapeHtml(args.customMessage) : '',
      inviterName: args.inviterName ?? '',
    };
    await this.send({
      to: args.to,
      subject: override.subject
        ? this.renderTemplate(override.subject, vars)
        : `You have been invited to ${vars.appName || 'Jira Clone'}`,
      html: override.html
        ? this.renderTemplate(override.html, vars)
        : invitationFallbackHtml(vars),
      type: MailType.OTHER,
    });
  }
}

/**
 * Every placeholder defaults to empty string so admin templates that
 * reference variables not relevant to their template (e.g. `{{otp}}` in
 * the invitation template) render blank instead of leaking `{{otp}}`
 * literal. Per-template overrides pick what they actually populate.
 */
function emptyPlaceholders(): Record<EmailTemplatePlaceholder, string> {
  return EMAIL_TEMPLATE_PLACEHOLDERS.reduce(
    (acc, key) => {
      acc[key] = '';
      return acc;
    },
    {} as Record<EmailTemplatePlaceholder, string>,
  );
}

function resolveFrontendBase(): string {
  return ENV.FRONTEND_URL || ENV.CORS_ORIGIN.split(',')[0]?.trim() || '';
}

function resolveDashboardUrl(): string {
  const base = resolveFrontendBase();
  return base ? `${base}/dashboard` : '/dashboard';
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function oauthLinkedFallbackHtml(vars: {
  appName: string;
  providerLabel: string;
  recipientEmail: string;
}): string {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:480px;margin:24px auto;padding:0 16px;color:#172b4d">
    <h2 style="margin:0 0 12px">${vars.providerLabel} sign-in linked</h2>
    <p>Hi, we connected <strong>${vars.providerLabel}</strong> as a sign-in method for your ${vars.appName} account <strong>${vars.recipientEmail}</strong>.</p>
    <p style="color:#5e6c84;font-size:14px;margin-top:16px">Didn't do this? Sign in and disconnect ${vars.providerLabel} from your profile's <em>Connected accounts</em> section, and consider rotating your password.</p>
  </body></html>`;
}

function welcomeFallbackHtml(vars: {
  appName: string;
  recipientEmail: string;
}): string {
  const name = vars.appName || 'Jira Clone';
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:480px;margin:24px auto;padding:0 16px;color:#172b4d">
    <h2>Welcome to ${name}!</h2>
    <p>Hi, your account <strong>${vars.recipientEmail}</strong> is now verified and ready to use.</p>
    <p>Sign in to get started.</p>
  </body></html>`;
}

function digestFallbackHtml(vars: {
  appName: string;
  recipientName: string;
  notificationsHtml: string;
  dashboardUrl: string;
}): string {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:560px;margin:24px auto;padding:0 16px;color:#1f2937">
    <h2 style="margin:0 0 16px">Hi ${escapeHtml(vars.recipientName)},</h2>
    <p>Here is your daily summary of unread notifications from ${escapeHtml(vars.appName || 'Jira Clone')}:</p>
    <ul style="list-style:none;padding:0;margin:16px 0">${vars.notificationsHtml}</ul>
    <p style="margin:24px 0"><a href="${vars.dashboardUrl}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">Open dashboard</a></p>
    <p style="color:#6b7280;font-size:12px;margin-top:24px">Adjust your email preferences in profile settings.</p>
  </body></html>`;
}

function invitationFallbackHtml(vars: {
  appName: string;
  signUpUrl: string;
  customMessage: string;
  inviterName: string;
}): string {
  const inviter = vars.inviterName
    ? `<strong>${escapeHtml(vars.inviterName)}</strong> has`
    : 'An administrator has';
  const customLine = vars.customMessage ? `<p>${vars.customMessage}</p>` : '';
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:560px;margin:24px auto;padding:0 16px;color:#1f2937">
    <h2 style="margin:0 0 16px">You have been invited</h2>
    <p>${inviter} invited you to join ${escapeHtml(vars.appName || 'Jira Clone')}. Click the link below to create your account:</p>
    ${customLine}
    <p style="margin:24px 0"><a href="${vars.signUpUrl}" style="background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">Sign up</a></p>
    <p style="color:#6b7280;font-size:12px">If the button doesn't work, paste this link in your browser:<br/>${vars.signUpUrl}</p>
  </body></html>`;
}
