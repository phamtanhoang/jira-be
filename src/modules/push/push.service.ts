import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as webPush from 'web-push';
import { ENV, MSG } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';

/**
 * Web Push wrapper — VAPID-keyed delivery to browser PushSubscriptions.
 *
 * Usage:
 *   - FE calls `pushManager.subscribe({ applicationServerKey: VAPID_PUBLIC })`
 *     and POSTs the resulting subscription to `/push/subscribe`.
 *   - NotificationsService.create() ALSO triggers `sendToUser(userId, payload)`
 *     fire-and-forget when push is configured.
 *
 * The whole module is a no-op when VAPID keys are missing — endpoints
 * return 503 explicitly so the FE can hide its UI rather than guess.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly enabled =
    !!ENV.VAPID_PUBLIC_KEY && !!ENV.VAPID_PRIVATE_KEY && !!ENV.VAPID_SUBJECT;

  constructor(private prisma: PrismaService) {
    if (this.enabled) {
      try {
        webPush.setVapidDetails(
          ENV.VAPID_SUBJECT,
          ENV.VAPID_PUBLIC_KEY,
          ENV.VAPID_PRIVATE_KEY,
        );
      } catch (err) {
        this.logger.warn(`web-push setVapidDetails failed: ${String(err)}`);
      }
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  publicKey(): string | null {
    return this.enabled ? ENV.VAPID_PUBLIC_KEY : null;
  }

  async subscribe(
    userId: string,
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    userAgent?: string,
  ) {
    if (!this.enabled) {
      throw new ServiceUnavailableException(MSG.ERROR.PUSH_NOT_CONFIGURED);
    }
    const row = await this.prisma.pushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      create: {
        userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent: userAgent ?? null,
      },
      update: {
        userId,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent: userAgent ?? null,
      },
    });
    return { message: MSG.SUCCESS.PUSH_SUBSCRIBED, id: row.id };
  }

  async unsubscribe(userId: string, endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({
      where: { userId, endpoint },
    });
    return { message: MSG.SUCCESS.PUSH_UNSUBSCRIBED };
  }

  /**
   * Fire-and-forget — never throws out to the caller. Iterates a user's
   * subscriptions and sends; 410/404 responses (expired) prune the row.
   */
  sendToUser(
    userId: string,
    payload: { title: string; body?: string | null; link?: string | null },
  ): void {
    if (!this.enabled) return;
    void this.deliver(userId, payload).catch((err: unknown) =>
      this.logger.warn(`push send failed for ${userId}: ${String(err)}`),
    );
  }

  private async deliver(
    userId: string,
    payload: { title: string; body?: string | null; link?: string | null },
  ) {
    const rows = await this.prisma.pushSubscription.findMany({
      where: { userId },
    });
    if (rows.length === 0) return;
    const body = JSON.stringify({
      title: payload.title,
      body: payload.body ?? '',
      link: payload.link ?? '/',
    });
    for (const r of rows) {
      try {
        await webPush.sendNotification(
          {
            endpoint: r.endpoint,
            keys: { p256dh: r.p256dh, auth: r.auth },
          },
          body,
        );
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // Expired subscription — clean up so we stop trying.
          await this.prisma.pushSubscription
            .delete({ where: { id: r.id } })
            .catch(() => null);
        } else {
          this.logger.debug(`push send error: ${String(err)}`);
        }
      }
    }
  }
}
