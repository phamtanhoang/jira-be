import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private readonly resend: Resend;
  private readonly logger = new Logger(MailService.name);

  constructor(private configService: ConfigService) {
    this.resend = new Resend(this.configService.get<string>('resend.apiKey'));
  }

  async sendVerificationEmail(email: string, otp: string): Promise<void> {
    try {
      await this.resend.emails.send({
        from: 'Jira App <onboarding@resend.dev>',
        to: email,
        subject: 'Verify your email',
        html: `
          <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto;">
            <h2>Email Verification</h2>
            <p>Your verification code is:</p>
            <h1 style="letter-spacing: 8px; text-align: center; background: #f4f4f4; padding: 16px; border-radius: 8px;">${otp}</h1>
            <p>This code expires in 10 minutes.</p>
          </div>
        `,
      });
      this.logger.log(`Verification email sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send email to ${email}`, error);
      throw error;
    }
  }
}
