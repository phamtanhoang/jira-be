/**
 * Unit tests for NotificationsService.
 *
 * Focus on the contract callers depend on:
 *   - create() / createMany() never throw (fire-and-forget)
 *   - createMany() de-dupes recipient IDs and skips empty ones
 *   - markRead() rejects cross-user reads
 *
 * We mock PrismaService — these are pure logic tests, no DB.
 */
import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from '@/modules/notifications/notifications.service';

type AnyFn = (...args: unknown[]) => unknown;

function createMockPrisma() {
  return {
    notification: {
      create: jest.fn<Promise<unknown>, unknown[]>(),
      createMany: jest.fn<Promise<unknown>, unknown[]>(),
      findUnique: jest.fn<Promise<unknown>, unknown[]>(),
      update: jest.fn<Promise<unknown>, unknown[]>(),
      updateMany: jest.fn<Promise<unknown>, unknown[]>(),
      delete: jest.fn<Promise<unknown>, unknown[]>(),
      count: jest.fn<Promise<number>, unknown[]>(),
    },
    $transaction: jest.fn<Promise<unknown[]>, [AnyFn[]]>(),
  };
}

describe('NotificationsService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: NotificationsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new NotificationsService(prisma as never);
  });

  describe('create()', () => {
    it('passes payload + recipient through to prisma.create', () => {
      prisma.notification.create.mockResolvedValueOnce({ id: 'n1' });
      service.create('user-1', {
        type: 'ISSUE_ASSIGNED',
        title: 'You were assigned',
        body: 'PROJ-1',
        link: '/issues/PROJ-1',
      });
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: 'ISSUE_ASSIGNED',
          title: 'You were assigned',
          body: 'PROJ-1',
          link: '/issues/PROJ-1',
        },
      });
    });

    it('never throws when prisma rejects (fire-and-forget contract)', async () => {
      prisma.notification.create.mockRejectedValueOnce(new Error('boom'));
      expect(() =>
        service.create('user-1', { type: 'ISSUE_ASSIGNED', title: 't' }),
      ).not.toThrow();
      // Let the rejection settle so jest doesn't flag an unhandled rejection.
      await new Promise((r) => setImmediate(r));
    });
  });

  describe('createMany()', () => {
    it('de-duplicates recipient ids and drops empties', () => {
      prisma.notification.createMany.mockResolvedValueOnce({ count: 2 });
      service.createMany(['u1', 'u2', 'u1', '', 'u2'], {
        type: 'COMMENT_CREATED',
        title: 'New comment',
      });
      expect(prisma.notification.createMany).toHaveBeenCalledTimes(1);
      const arg = prisma.notification.createMany.mock.calls[0][0] as {
        data: { userId: string }[];
      };
      const ids = arg.data.map((d) => d.userId).sort();
      expect(ids).toEqual(['u1', 'u2']);
    });

    it('skips the prisma call entirely when no recipients remain', () => {
      service.createMany([], { type: 'ISSUE_ASSIGNED', title: 't' });
      service.createMany(['', undefined as unknown as string], {
        type: 'ISSUE_ASSIGNED',
        title: 't',
      });
      expect(prisma.notification.createMany).not.toHaveBeenCalled();
    });
  });

  describe('markRead()', () => {
    it('throws NotFound when notification does not exist', async () => {
      prisma.notification.findUnique.mockResolvedValueOnce(null);
      await expect(service.markRead('n1', 'user-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws NotFound when notification belongs to another user', async () => {
      prisma.notification.findUnique.mockResolvedValueOnce({
        id: 'n1',
        userId: 'someone-else',
        readAt: null,
      });
      await expect(service.markRead('n1', 'user-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns the row unchanged when already read (no-op)', async () => {
      const already = {
        id: 'n1',
        userId: 'user-1',
        readAt: new Date('2026-01-01'),
      };
      prisma.notification.findUnique.mockResolvedValueOnce(already);
      const out = await service.markRead('n1', 'user-1');
      expect(out).toBe(already);
      expect(prisma.notification.update).not.toHaveBeenCalled();
    });

    it('updates readAt when notification is unread', async () => {
      prisma.notification.findUnique.mockResolvedValueOnce({
        id: 'n1',
        userId: 'user-1',
        readAt: null,
      });
      prisma.notification.update.mockResolvedValueOnce({
        id: 'n1',
        userId: 'user-1',
        readAt: new Date(),
      });
      await service.markRead('n1', 'user-1');
      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'n1' },
        data: { readAt: expect.any(Date) },
      });
    });
  });

  describe('unreadCount()', () => {
    it('counts only unread + per-user', async () => {
      prisma.notification.count.mockResolvedValueOnce(7);
      const out = await service.unreadCount('user-1');
      expect(out).toEqual({ count: 7 });
      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', readAt: null },
      });
    });
  });
});
