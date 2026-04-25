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
    const info = await transporter.sendMail({
      from: args.from,
      to: args.to,
      subject: args.subject,
      html: args.html,
    });
    return info.messageId ?? null;
  }

  /**
   * Re-create the cached SMTP transporter on next send. Called by the
   * settings controller after any update to `app.email` so a credential
   * change takes effect without a full server restart.
   */
  invalidateTransport() {
    this.smtpCache = null;
  }

  async sendVerificationEmail(email: string, otp: string): Promise<void> {
    const appInfo = await this.getAppInfo();
    await this.send({
      to: email,
      subject: 'Verify your email',
      html: otpEmailTemplate({
        appName: appInfo.name ?? '',
        logoUrl: appInfo.logoUrl ?? '',
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
    await this.send({
      to: email,
      subject: 'Reset your password',
      html: otpEmailTemplate({
        appName: appInfo.name ?? '',
        logoUrl: appInfo.logoUrl ?? '',
        otp,
        expirySeconds: ENV.TOKEN_VERIFY_EXPIRY,
        title: 'Reset your password',
        description: 'Enter the code below to reset your password.',
      }),
      type: MailType.PASSWORD_RESET,
    });
  }
}
