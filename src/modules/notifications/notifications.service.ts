import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MSG } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import type { NotificationPayload } from './dto';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private prisma: PrismaService) {}

  // ─── Write side ─────────────────────────────────────
  // create / createMany are fire-and-forget. They never throw — a failure to
  // write a notification MUST NOT bubble up and kill the user-facing
  // request that triggered it (assigning an issue, posting a comment, etc.).

  create(userId: string, payload: NotificationPayload): void {
    void this.prisma.notification
      .create({
        data: {
          userId,
          type: payload.type,
          title: payload.title,
          body: payload.body,
          link: payload.link,
        },
      })
      .catch((err) => {
        this.logger.error(
          `Failed to write notification for user=${userId} type=${payload.type}`,
          err instanceof Error ? err.stack : String(err),
        );
      });
  }

  // De-duplicates the recipient set, drops empties, then issues a single
  // createMany. Used for fan-out (notify reporter + assignee + watchers
  // when a comment lands).
  createMany(userIds: string[], payload: NotificationPayload): void {
    const unique = Array.from(new Set(userIds.filter(Boolean)));
    if (unique.length === 0) return;
    void this.prisma.notification
      .createMany({
        data: unique.map((userId) => ({
          userId,
          type: payload.type,
          title: payload.title,
          body: payload.body,
          link: payload.link,
        })),
      })
      .catch((err) => {
        this.logger.error(
          `Failed to write fan-out notification (${unique.length} recipients) type=${payload.type}`,
          err instanceof Error ? err.stack : String(err),
        );
      });
  }

  // ─── Read side ──────────────────────────────────────

  async findAll(
    userId: string,
    opts: { unread?: boolean; page?: number; pageSize?: number },
  ) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const where = {
      userId,
      ...(opts.unread && { readAt: null }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      hasMore: skip + data.length < total,
      nextCursor: null,
    };
  }

  async unreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: { userId, readAt: null },
    });
    return { count };
  }

  async markRead(notificationId: string, userId: string) {
    const noti = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!noti || noti.userId !== userId) {
      throw new NotFoundException(MSG.ERROR.NOTIFICATION_NOT_FOUND);
    }
    if (noti.readAt) return noti; // already read — no-op
    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { count: result.count };
  }

  async delete(notificationId: string, userId: string) {
    const noti = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!noti || noti.userId !== userId) {
      throw new NotFoundException(MSG.ERROR.NOTIFICATION_NOT_FOUND);
    }
    await this.prisma.notification.delete({ where: { id: notificationId } });
  }

  // ─── Preferences ────────────────────────────────────
  // Per-(user, type) toggle for in-app + email channels. Missing rows mean
  // "default" (in-app on, email off) — we don't pre-seed on signup, just
  // upsert on first toggle.

  async getPreferences(userId: string) {
    return this.prisma.notificationPreference.findMany({
      where: { userId },
      orderBy: { type: 'asc' },
    });
  }

  /**
   * Bulk upsert. Body: `{ ISSUE_ASSIGNED: { inApp: true, email: false }, ... }`.
   * We don't bother diffing against current state — Prisma's upsert is
   * cheap and the dataset is tiny (~7 rows max per user).
   */
  async updatePreferences(
    userId: string,
    prefs: Record<string, { inApp?: boolean; email?: boolean }>,
  ) {
    const ops = Object.entries(prefs).map(([type, value]) =>
      this.prisma.notificationPreference.upsert({
        where: { userId_type: { userId, type } },
        create: {
          userId,
          type,
          inApp: value.inApp ?? true,
          email: value.email ?? false,
        },
        update: {
          ...(value.inApp !== undefined && { inApp: value.inApp }),
          ...(value.email !== undefined && { email: value.email }),
        },
      }),
    );
    await this.prisma.$transaction(ops);
    return this.getPreferences(userId);
  }

  /**
   * Used by triggers (issues, comments) to gate the actual write. When the
   * user has no row for this type, we fall back to the default policy
   * (in-app on, email off). Returns true if the user has opted in for the
   * given channel.
   */
  async shouldNotify(
    userId: string,
    type: string,
    channel: 'inApp' | 'email',
  ): Promise<boolean> {
    const pref = await this.prisma.notificationPreference.findUnique({
      where: { userId_type: { userId, type } },
    });
    if (!pref) return channel === 'inApp'; // default: in-app on, email off
    return channel === 'inApp' ? pref.inApp : pref.email;
  }
}
