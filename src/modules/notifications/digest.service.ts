import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DAY_MS, ENV } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { MailService } from '@/core/mail/mail.service';

/**
 * Daily email digest of unread in-app notifications.
 *
 * Runs at 08:00 server time. For each user that has at least one email-eligible
 * notification preference enabled, we group their unread notifications from
 * the last 24h and send a single summary email. Each notification is "tagged"
 * by setting `digestSentAt` (a soft marker) so the next run skips it. The
 * cron is idempotent — re-running within the same window won't re-send.
 *
 * Phase 1.6 — depends on the NotificationPreference table from Phase 1.5.
 */
@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  // Disabled (schedule = never-fires expression) for the personal /
  // CV-showcase deployment. The daily digest scans every user's unread
  // notifications, which is overkill when there's only one user. Re-enable
  // with `CronExpression.EVERY_DAY_AT_8AM` when the app has real users.
  @Cron('0 0 0 1 1 *', { name: 'notification-digest' })
  async runDailyDigest() {
    if (ENV.IS_TEST) return; // never run during unit tests

    const since = new Date(Date.now() - DAY_MS);

    // Collect unread, undigested notifications from the last 24h, grouped by
    // user. We rely on (userId, readAt) index — see notification.prisma.
    const recipients = await this.prisma.notification.groupBy({
      by: ['userId'],
      where: {
        readAt: null,
        digestSentAt: null,
        createdAt: { gte: since },
      },
      _count: { _all: true },
    });

    if (recipients.length === 0) return;

    let sent = 0;
    let skipped = 0;

    for (const r of recipients) {
      const result = await this.sendDigestFor(r.userId).catch((err) => {
        this.logger.warn(`digest send failed for ${r.userId}: ${String(err)}`);
        return null;
      });
      if (result?.sent) sent++;
      else skipped++;
    }

    this.logger.log(
      `digest cron: ${sent} sent, ${skipped} skipped (${recipients.length} candidates)`,
    );
  }

  /**
   * Per-user digest. Pulled out so we can reuse from a future "send me a
   * test digest" admin endpoint.
   */
  async sendDigestFor(
    userId: string,
  ): Promise<{ sent: boolean; count: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, emailVerified: true },
    });
    if (!user || !user.emailVerified) return { sent: false, count: 0 };

    // Pull unread + undigested notifications. Filter by per-type email
    // preference: if a user opted out for a given type, drop those rows.
    const candidates = await this.prisma.notification.findMany({
      where: {
        userId,
        readAt: null,
        digestSentAt: null,
        createdAt: { gte: new Date(Date.now() - DAY_MS) },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    if (candidates.length === 0) return { sent: false, count: 0 };

    const prefs = await this.prisma.notificationPreference.findMany({
      where: { userId },
    });
    const prefByType = new Map(prefs.map((p) => [p.type, p]));

    const eligible = candidates.filter((n) => {
      const pref = prefByType.get(n.type);
      // Default: email OFF unless user has explicitly opted in.
      return pref?.email === true;
    });

    if (eligible.length === 0) {
      // Mark all candidates as digested so we don't re-evaluate tomorrow.
      await this.prisma.notification.updateMany({
        where: { id: { in: candidates.map((c) => c.id) } },
        data: { digestSentAt: new Date() },
      });
      return { sent: false, count: 0 };
    }

    const notificationsHtml = renderDigestItems(eligible);
    await this.mail.sendDigestEmail({
      to: user.email,
      recipientName: user.name,
      notificationsHtml,
      notificationCount: eligible.length,
    });

    await this.prisma.notification.updateMany({
      where: { id: { in: candidates.map((c) => c.id) } },
      data: { digestSentAt: new Date() },
    });

    return { sent: true, count: eligible.length };
  }
}

/**
 * Render ONLY the inner `<li>` items — surrounding chrome (header, intro,
 * CTA, footer) is owned by the admin-editable `digest` email template
 * and substituted in via `{{notificationsHtml}}`. Keeping the list shape
 * in code lets the layout stay consistent across templates while admins
 * still control branding.
 */
function renderDigestItems(
  rows: {
    title: string;
    body: string | null;
    link: string | null;
    createdAt: Date;
  }[],
): string {
  const baseUrl = ENV.FRONTEND_URL || ENV.CORS_ORIGIN.split(',')[0] || '';
  return rows
    .map((n) => {
      const linkAttr = n.link ? `href="${baseUrl}${n.link}"` : '';
      const titleHtml = n.link
        ? `<a ${linkAttr} style="color:#2563eb;text-decoration:none">${escapeHtml(n.title)}</a>`
        : escapeHtml(n.title);
      const bodyHtml = n.body
        ? `<div style="color:#6b7280;font-size:13px;margin-top:2px">${escapeHtml(n.body)}</div>`
        : '';
      return `<li style="padding:10px 0;border-bottom:1px solid #e5e7eb">
        <div style="font-weight:500">${titleHtml}</div>
        ${bodyHtml}
      </li>`;
    })
    .join('');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
