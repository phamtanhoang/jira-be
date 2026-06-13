/**
 * Unit tests for IssuesWatchersService.
 *
 * Background: the FE recently reported "click star, API succeeds but UI
 * doesn't update". Root cause was that star/unstar/watch/unwatch never
 * invalidated the cache tags `issue:id:X` + `issue:key:Y` that
 * `findByKey` / `findById` wrap their reads in. The fix added a
 * `bustIssueCache(issueId, issueKey)` helper called after every mutation.
 *
 * This suite pins:
 *   1. Each mutator hits the right Prisma table with the right shape.
 *   2. `bustIssueCache` invalidates BOTH tags in one call.
 *   3. Star/watch are idempotent (upsert pattern).
 *   4. Unstar/unwatch swallow the "row not found" Prisma error so a
 *      double-unstar doesn't 500.
 *   5. `autoWatch` is fire-and-forget — it never throws or awaits.
 */
import { IssuesWatchersService } from '@/modules/issues/services/issues-watchers.service';

const ISSUE_ID = 'i0000000-0000-0000-0000-000000000001';
const ISSUE_KEY = 'PROJ-42';
const USER_ID = 'u0000000-0000-0000-0000-000000000001';

function createMockPrisma() {
  const mock = {
    issueStar: {
      upsert: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    issueWatcher: {
      upsert: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  return mock;
}

function createMockCacheTags() {
  return {
    invalidateTag: jest.fn().mockResolvedValue(undefined),
    invalidateTags: jest.fn().mockResolvedValue(undefined),
  };
}

function createMockIssuesService(
  overrides: Partial<{ key: string; id: string }> = {},
) {
  return {
    findById: jest.fn().mockResolvedValue({
      id: overrides.id ?? ISSUE_ID,
      key: overrides.key ?? ISSUE_KEY,
    }),
  };
}

describe('IssuesWatchersService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let cacheTags: ReturnType<typeof createMockCacheTags>;
  let issuesService: ReturnType<typeof createMockIssuesService>;
  let service: IssuesWatchersService;

  beforeEach(() => {
    prisma = createMockPrisma();
    cacheTags = createMockCacheTags();
    issuesService = createMockIssuesService();
    service = new IssuesWatchersService(
      prisma as never,
      cacheTags as never,
      issuesService as never,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('star()', () => {
    it('upserts an IssueStar row with the right compound key', async () => {
      await service.star(ISSUE_ID, USER_ID);
      expect(prisma.issueStar.upsert).toHaveBeenCalledWith({
        where: { issueId_userId: { issueId: ISSUE_ID, userId: USER_ID } },
        update: {},
        create: { issueId: ISSUE_ID, userId: USER_ID },
      });
    });

    it('returns { starred: true } on success', async () => {
      await expect(service.star(ISSUE_ID, USER_ID)).resolves.toEqual({
        starred: true,
      });
    });

    it('is idempotent — calling twice still results in one logical row (upsert)', async () => {
      await service.star(ISSUE_ID, USER_ID);
      await service.star(ISSUE_ID, USER_ID);
      expect(prisma.issueStar.upsert).toHaveBeenCalledTimes(2);
      // Prisma's `upsert` collapses to no-op on conflict; we just assert
      // the service called it twice (no thrown error, no special-casing).
    });

    it('invalidates BOTH issue:id and issue:key tags', async () => {
      await service.star(ISSUE_ID, USER_ID);
      expect(cacheTags.invalidateTags).toHaveBeenCalledTimes(1);
      expect(cacheTags.invalidateTags).toHaveBeenCalledWith([
        `issue:id:${ISSUE_ID}`,
        `issue:key:${ISSUE_KEY}`,
      ]);
    });

    it('looks up the issue first (permission check happens inside findById)', async () => {
      await service.star(ISSUE_ID, USER_ID);
      expect(issuesService.findById).toHaveBeenCalledWith(ISSUE_ID, USER_ID);
    });

    it('propagates findById errors (so 404/403 reach the controller unchanged)', async () => {
      const err = new Error('IssueNotFound');
      issuesService.findById.mockRejectedValueOnce(err);
      await expect(service.star(ISSUE_ID, USER_ID)).rejects.toThrow(
        'IssueNotFound',
      );
      expect(prisma.issueStar.upsert).not.toHaveBeenCalled();
      expect(cacheTags.invalidateTags).not.toHaveBeenCalled();
    });

    it('does NOT await cache invalidation — returns even if invalidate is slow', async () => {
      let resolveInvalidate!: () => void;
      cacheTags.invalidateTags.mockReturnValueOnce(
        new Promise<void>((r) => {
          resolveInvalidate = r;
        }),
      );
      const result = await service.star(ISSUE_ID, USER_ID);
      expect(result).toEqual({ starred: true });
      // Service returned BEFORE invalidate resolved — verified by the
      // fact that the await did not deadlock. Resolve now to flush.
      resolveInvalidate();
    });

    it('uses the key from findById (not a separately-passed key) — protects against drift', async () => {
      issuesService.findById.mockResolvedValueOnce({
        id: ISSUE_ID,
        key: 'WRONG-KEY-OVERRIDE',
      });
      await service.star(ISSUE_ID, USER_ID);
      expect(cacheTags.invalidateTags).toHaveBeenCalledWith([
        `issue:id:${ISSUE_ID}`,
        `issue:key:WRONG-KEY-OVERRIDE`,
      ]);
    });
  });

  describe('unstar()', () => {
    it('deletes the IssueStar row', async () => {
      await service.unstar(ISSUE_ID, USER_ID);
      expect(prisma.issueStar.delete).toHaveBeenCalledWith({
        where: { issueId_userId: { issueId: ISSUE_ID, userId: USER_ID } },
      });
    });

    it('returns { starred: false } on success', async () => {
      await expect(service.unstar(ISSUE_ID, USER_ID)).resolves.toEqual({
        starred: false,
      });
    });

    it('swallows "row not found" so unstarring an unstarred issue is a silent no-op', async () => {
      prisma.issueStar.delete.mockRejectedValueOnce(
        new Error('Record to delete does not exist.'),
      );
      await expect(service.unstar(ISSUE_ID, USER_ID)).resolves.toEqual({
        starred: false,
      });
    });

    it('busts cache even on the silent no-op path (so a stale star indicator clears)', async () => {
      prisma.issueStar.delete.mockRejectedValueOnce(new Error('boom'));
      await service.unstar(ISSUE_ID, USER_ID);
      expect(cacheTags.invalidateTags).toHaveBeenCalledWith([
        `issue:id:${ISSUE_ID}`,
        `issue:key:${ISSUE_KEY}`,
      ]);
    });
  });

  describe('watch()', () => {
    it('upserts an IssueWatcher row', async () => {
      await service.watch(ISSUE_ID, USER_ID);
      expect(prisma.issueWatcher.upsert).toHaveBeenCalledWith({
        where: { issueId_userId: { issueId: ISSUE_ID, userId: USER_ID } },
        update: {},
        create: { issueId: ISSUE_ID, userId: USER_ID },
      });
    });

    it('returns { watching: true }', async () => {
      await expect(service.watch(ISSUE_ID, USER_ID)).resolves.toEqual({
        watching: true,
      });
    });

    it('invalidates both tags', async () => {
      await service.watch(ISSUE_ID, USER_ID);
      expect(cacheTags.invalidateTags).toHaveBeenCalledWith([
        `issue:id:${ISSUE_ID}`,
        `issue:key:${ISSUE_KEY}`,
      ]);
    });
  });

  describe('unwatch()', () => {
    it('deletes the IssueWatcher row', async () => {
      await service.unwatch(ISSUE_ID, USER_ID);
      expect(prisma.issueWatcher.delete).toHaveBeenCalledWith({
        where: { issueId_userId: { issueId: ISSUE_ID, userId: USER_ID } },
      });
    });

    it('returns { watching: false }', async () => {
      await expect(service.unwatch(ISSUE_ID, USER_ID)).resolves.toEqual({
        watching: false,
      });
    });

    it('swallows "row not found" so unwatching an unwatched issue is a silent no-op', async () => {
      prisma.issueWatcher.delete.mockRejectedValueOnce(new Error('not found'));
      await expect(service.unwatch(ISSUE_ID, USER_ID)).resolves.toEqual({
        watching: false,
      });
    });
  });

  describe('autoWatch()', () => {
    it('upserts watcher and returns void synchronously (fire-and-forget)', () => {
      // The whole point: no await, no return value, no throw.
      const ret = service.autoWatch(ISSUE_ID, USER_ID);
      expect(ret).toBeUndefined();
      expect(prisma.issueWatcher.upsert).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when issueId is falsy', () => {
      service.autoWatch('', USER_ID);
      expect(prisma.issueWatcher.upsert).not.toHaveBeenCalled();
    });

    it('is a no-op when userId is falsy', () => {
      service.autoWatch(ISSUE_ID, '');
      expect(prisma.issueWatcher.upsert).not.toHaveBeenCalled();
    });

    it('does not throw if upsert rejects (silenced by .catch)', () => {
      prisma.issueWatcher.upsert.mockRejectedValueOnce(new Error('DB down'));
      expect(() => service.autoWatch(ISSUE_ID, USER_ID)).not.toThrow();
    });
  });

  describe('findWatchers()', () => {
    it('asserts access via findById before reading', async () => {
      await service.findWatchers(ISSUE_ID, USER_ID);
      expect(issuesService.findById).toHaveBeenCalledWith(ISSUE_ID, USER_ID);
    });

    it('returns the watchers list as user previews (not raw join rows)', async () => {
      prisma.issueWatcher.findMany.mockResolvedValueOnce([
        {
          user: { id: 'u1', name: 'Alice', email: 'a@b.c', image: null },
        },
        {
          user: { id: 'u2', name: 'Bob', email: 'b@b.c', image: null },
        },
      ]);
      const result = await service.findWatchers(ISSUE_ID, USER_ID);
      expect(result).toEqual([
        { id: 'u1', name: 'Alice', email: 'a@b.c', image: null },
        { id: 'u2', name: 'Bob', email: 'b@b.c', image: null },
      ]);
    });

    it('returns an empty array when there are no watchers', async () => {
      prisma.issueWatcher.findMany.mockResolvedValueOnce([]);
      await expect(service.findWatchers(ISSUE_ID, USER_ID)).resolves.toEqual(
        [],
      );
    });

    it('does NOT invalidate cache (read-only operation)', async () => {
      await service.findWatchers(ISSUE_ID, USER_ID);
      expect(cacheTags.invalidateTags).not.toHaveBeenCalled();
      expect(cacheTags.invalidateTag).not.toHaveBeenCalled();
    });
  });
});
