import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { PrismaService } from '@/core/database/prisma.service';
import { ENV, SETTING_KEYS } from '@/core/constants';
import { verifyEmailTemplate } from './templates/verify-email.template';

interface AppInfo {
  name: string;
  logoUrl: string;
}

@Injectable()
export class MailService {
  private readonly resend = new Resend(ENV.RESEND_API_KEY);
  private readonly logger = new Logger(MailService.name);

  constructor(private prisma: PrismaService) {}

  private async getAppInfo(): Promise<AppInfo> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEYS.APP_INFO },
    });
    const value = setting?.value as Record<string, string> | null;
    return {
      name: value?.name ?? '',
      logoUrl: value?.logoUrl ?? '',
    };
  }

  async sendVerificationEmail(email: string, otp: string): Promise<void> {
    const appInfo = await this.getAppInfo();
    const expirySeconds = ENV.TOKEN_VERIFY_EXPIRY;

    try {
      await this.resend.emails.send({
        from: `${appInfo.name} <onboarding@resend.dev>`,
        to: email,
        subject: 'Verify your email',
        html: verifyEmailTemplate({
          appName: appInfo.name,
          logoUrl: appInfo.logoUrl,
          otp,
          expirySeconds,
        }),
      });
      this.logger.log(`Verification email sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${email}`, error);
      throw error;
    }
  }
}
