import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { ENV, SETTING_KEYS } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { otpEmailTemplate } from './templates/otp-email.template';

@Injectable()
export class MailService {
  private readonly resend = new Resend(ENV.RESEND_API_KEY);
  private readonly logger = new Logger(MailService.name);

  constructor(private prisma: PrismaService) {}

  private async getSetting(key: string): Promise<Record<string, string>> {
    const setting = await this.prisma.setting.findUnique({ where: { key } });
    return (setting?.value as Record<string, string>) ?? {};
  }

  private async sendEmail(
    to: string,
    subject: string,
    html: string,
  ): Promise<void> {
    const [appInfo, appEmail] = await Promise.all([
      this.getSetting(SETTING_KEYS.APP_INFO),
      this.getSetting(SETTING_KEYS.APP_EMAIL),
    ]);

    try {
      await this.resend.emails.send({
        from: `${appInfo.name ?? ''} <${appEmail.email ?? ''}>`,
        to,
        subject,
        html,
      });
      this.logger.log(`${subject} email sent to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}`, error);
      throw error;
    }
  }

  async sendVerificationEmail(email: string, otp: string): Promise<void> {
    const appInfo = await this.getSetting(SETTING_KEYS.APP_INFO);

    return this.sendEmail(
      email,
      'Verify your email',
      otpEmailTemplate({
        appName: appInfo.name ?? '',
        logoUrl: appInfo.logoUrl ?? '',
        otp,
        expirySeconds: ENV.TOKEN_VERIFY_EXPIRY,
        title: 'Verify your email',
        description: 'Enter the code below to verify your email address.',
      }),
    );
  }

  async sendResetPasswordEmail(email: string, otp: string): Promise<void> {
    const appInfo = await this.getSetting(SETTING_KEYS.APP_INFO);

    return this.sendEmail(
      email,
      'Reset your password',
      otpEmailTemplate({
        appName: appInfo.name ?? '',
        logoUrl: appInfo.logoUrl ?? '',
        otp,
        expirySeconds: ENV.TOKEN_VERIFY_EXPIRY,
        title: 'Reset your password',
        description: 'Enter the code below to reset your password.',
      }),
    );
  }
}
