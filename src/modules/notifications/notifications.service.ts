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
}
