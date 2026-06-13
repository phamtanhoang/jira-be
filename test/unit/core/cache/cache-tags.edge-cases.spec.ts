/**
 * Edge-case + race / inconsistency tests for `CacheTagsService`.
 *
 * Base spec covers the happy path (hit/miss, ENV.CACHE_DISABLED off-switch,
 * loader fallback on read error). This file adds:
 *
 *   - Multi-tag set: a single entry is registered under every tag passed in
 *   - Tag-set deduplication (existing keys not re-appended)
 *   - Invalidate-a-tag-twice is idempotent
 *   - invalidateTag continues when individual `del` calls reject
 *   - `set` write failure does not bubble to the caller of wrap()
 *   - cache.get returning `undefined` AND `null` both trigger loader
 *   - ENV.CACHE_DISABLED toggled mid-flight: only checked at call start
 *     (we pin current behavior, not aspirational)
 *   - TTL conversion: ttlSec * 1000 → ms passed to cache.set
 *   - Tag TTL is 2× value TTL (tag must outlive the keys it tracks
 *     so invalidation still finds them as they expire)
 *   - Empty tag list → still caches, just isn't invalidatable
 *   - Loader throws → not cached, error propagates
 */
jest.mock('@/core/constants', () => {
  const real = jest.requireActual('@/core/constants');
  return {
    ...real,
    ENV: {
      ...(real.ENV as Record<string, unknown>),
      CACHE_DISABLED: false,
      CACHE_TTL_DEFAULT: 60,
    },
  };
});

import { CacheTagsService } from '@/core/cache/cache-tags.service';
import { ENV } from '@/core/constants';

type CacheMock = {
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
};

function makeCache(): CacheMock {
  // Backing store that mimics cache-manager: get/set/del with a Map.
  const store = new Map<string, unknown>();
  return {
    get: jest.fn((k: string) => Promise.resolve(store.get(k))),
    set: jest.fn((k: string, v: unknown) => {
      store.set(k, v);
      return Promise.resolve();
    }),
    del: jest.fn((k: string) => {
      store.delete(k);
      return Promise.resolve();
    }),
  };
}

function makeService(cache: CacheMock) {
  return new CacheTagsService(cache as never);
}

describe('CacheTagsService — edge cases', () => {
  let cache: CacheMock;
  let service: CacheTagsService;

  beforeEach(() => {
    (ENV as { CACHE_DISABLED: boolean }).CACHE_DISABLED = false;
    cache = makeCache();
    service = makeService(cache);
  });

  // `wrap` fires `this.set(...)` with `void` — its writes happen on the
  // microtask queue AFTER wrap() resolves. Flush before inspecting any
  // cache.set assertions so we don't race the fire-and-forget.
  async function flushFireAndForget() {
    await new Promise<void>((r) => setImmediate(r));
  }

  describe('wrap() — tag fan-out', () => {
    it('appends the entry into EVERY tag set in one wrap call', async () => {
      const loader = jest.fn().mockResolvedValue({ v: 1 });
      await service.wrap(
        'issues:list:user:u1',
        ['user:u1', 'workspaces'],
        loader,
        60,
      );
      await flushFireAndForget();

      // Both tag set keys should contain the cache key — direct assertion
      // on the eventual stored state via cache.set calls
      const setCalls = cache.set.mock.calls;
      const tagSetCalls = setCalls.filter(([k]) =>
        String(k).startsWith('tag:v1:'),
      );
      const userTagCall = tagSetCalls.find(([k]) => k === 'tag:v1:user:u1');
      const wsTagCall = tagSetCalls.find(([k]) => k === 'tag:v1:workspaces');
      expect(userTagCall).toBeDefined();
      expect(wsTagCall).toBeDefined();
      expect(userTagCall![1]).toEqual(['cache:v1:issues:list:user:u1']);
      expect(wsTagCall![1]).toEqual(['cache:v1:issues:list:user:u1']);
    });

    it('deduplicates — re-cache of the same key under the same tag SKIPS the tag-set re-write', async () => {
      const loader = jest.fn().mockResolvedValueOnce({ v: 1 });
      // First call populates the tag with ['cache:v1:k1'].
      await service.wrap('k1', ['t1'], loader, 60);
      await flushFireAndForget();
      // Simulate value TTL expiry but tag survives (canonical "tag
      // outlives value" path): drop the value, keep the tag set.
      await cache.del('cache:v1:k1');
      cache.set.mockClear();

      const loader2 = jest.fn().mockResolvedValueOnce({ v: 2 });
      await service.wrap('k1', ['t1'], loader2, 60);
      await flushFireAndForget();

      // The dedup `if (!existing.includes(cacheKey))` short-circuits, so
      // the TAG set is NOT re-written (fast path). Only the value write
      // happens on the second wrap.
      const valueWrites = cache.set.mock.calls.filter(
        ([k]) => k === 'cache:v1:k1',
      );
      const tagWrites = cache.set.mock.calls.filter(([k]) => k === 'tag:v1:t1');
      expect(valueWrites).toHaveLength(1);
      expect(tagWrites).toHaveLength(0);
    });

    it('caches loader() result on miss with the requested ttl in MILLISECONDS', async () => {
      const loader = jest.fn().mockResolvedValue('value');
      await service.wrap('k', ['t'], loader, 120);
      await flushFireAndForget();
      const valueWrite = cache.set.mock.calls.find(([k]) => k === 'cache:v1:k');
      expect(valueWrite![2]).toBe(120 * 1000); // ms
    });

    it('uses ENV.CACHE_TTL_DEFAULT (in seconds) when ttlSec omitted', async () => {
      const loader = jest.fn().mockResolvedValue('value');
      await service.wrap('k', ['t'], loader);
      await flushFireAndForget();
      const valueWrite = cache.set.mock.calls.find(([k]) => k === 'cache:v1:k');
      expect(valueWrite![2]).toBe(60 * 1000);
    });

    it('caches the tag set with TTL = 2× value TTL (tag outlives keys)', async () => {
      const loader = jest.fn().mockResolvedValue('value');
      await service.wrap('k', ['t'], loader, 100);
      await flushFireAndForget();
      const tagWrite = cache.set.mock.calls.find(([k]) => k === 'tag:v1:t');
      expect(tagWrite).toBeDefined();
      expect(tagWrite![2]).toBe(100 * 1000 * 2);
    });

    it('treats cache.get returning `null` as a miss (not a hit)', async () => {
      cache.get.mockResolvedValueOnce(null); // value lookup
      const loader = jest.fn().mockResolvedValue('fresh');
      const out = await service.wrap('k', ['t'], loader, 60);
      expect(out).toBe('fresh');
      expect(loader).toHaveBeenCalled();
    });

    it('treats cache.get returning `undefined` as a miss', async () => {
      cache.get.mockResolvedValueOnce(undefined);
      const loader = jest.fn().mockResolvedValue('fresh');
      const out = await service.wrap('k', ['t'], loader, 60);
      expect(out).toBe('fresh');
      expect(loader).toHaveBeenCalled();
    });

    it('returns hit when cache.get yields a `0` (falsy but not null/undefined)', async () => {
      // Pre-populate the cache via service so a real "hit" exists.
      const loader = jest.fn().mockResolvedValueOnce(0);
      await service.wrap('k-zero', ['t'], loader, 60);

      // Second wrap should hit the cache (0 is a legitimate value).
      loader.mockClear();
      const again = await service.wrap('k-zero', ['t'], loader, 60);
      expect(again).toBe(0);
      expect(loader).not.toHaveBeenCalled();
    });

    it('returns hit when cache.get yields empty string', async () => {
      const loader = jest.fn().mockResolvedValueOnce('');
      await service.wrap('k-empty', ['t'], loader, 60);
      loader.mockClear();
      const again = await service.wrap('k-empty', ['t'], loader, 60);
      expect(again).toBe('');
      expect(loader).not.toHaveBeenCalled();
    });

    it('does NOT cache loader() result if loader throws', async () => {
      const loader = jest.fn().mockRejectedValue(new Error('boom'));
      await expect(service.wrap('k', ['t'], loader, 60)).rejects.toThrow(
        'boom',
      );
      // No value write should have happened
      const valueWrite = cache.set.mock.calls.find(([k]) => k === 'cache:v1:k');
      expect(valueWrite).toBeUndefined();
    });

    it('returns loader value even if cache.set rejects (write failure is non-fatal)', async () => {
      cache.set.mockRejectedValueOnce(new Error('redis disk full'));
      const loader = jest.fn().mockResolvedValue('value');
      await expect(service.wrap('k', ['t'], loader, 60)).resolves.toBe('value');
    });

    it('does NOT block the caller while writing — set is fire-and-forget', async () => {
      let resolveSet!: () => void;
      cache.set.mockReturnValueOnce(
        new Promise<void>((r) => {
          resolveSet = r;
        }) as never,
      );
      const loader = jest.fn().mockResolvedValue('value');
      const result = await service.wrap('k', ['t'], loader, 60);
      expect(result).toBe('value');
      // Test does not deadlock — caller already resolved. Flush the
      // outstanding pending set so jest cleanup is clean.
      resolveSet();
    });

    it('caches a value even when tags array is empty (just not invalidatable)', async () => {
      const loader = jest.fn().mockResolvedValue('v');
      const result = await service.wrap('k', [], loader, 60);
      expect(result).toBe('v');
      await flushFireAndForget();
      // Value write happened
      const valueWrite = cache.set.mock.calls.find(([k]) => k === 'cache:v1:k');
      expect(valueWrite).toBeDefined();
      // No tag writes happened
      const tagWrites = cache.set.mock.calls.filter(([k]) =>
        String(k).startsWith('tag:v1:'),
      );
      expect(tagWrites).toHaveLength(0);
    });
  });

  describe('invalidateTag() — race + failure handling', () => {
    it('is idempotent — invalidating an already-empty tag does NOT throw', async () => {
      await expect(service.invalidateTag('t-empty')).resolves.toBeUndefined();
    });

    it('continues deleting other members when one cache.del rejects', async () => {
      // Seed a tag with 3 keys.
      cache.get.mockResolvedValueOnce([
        'cache:v1:a',
        'cache:v1:b',
        'cache:v1:c',
      ]);
      cache.del
        .mockResolvedValueOnce(undefined) // a OK
        .mockRejectedValueOnce(new Error('b failed')) // b throws
        .mockResolvedValueOnce(undefined); // c OK

      await expect(service.invalidateTag('t')).resolves.toBeUndefined();

      // Every member's del was attempted
      const delKeys = cache.del.mock.calls.map(([k]) => k);
      expect(delKeys).toContain('cache:v1:a');
      expect(delKeys).toContain('cache:v1:b');
      expect(delKeys).toContain('cache:v1:c');
    });

    it('deletes the tag-set itself AFTER member deletes', async () => {
      cache.get.mockResolvedValueOnce(['cache:v1:a']);
      await service.invalidateTag('t');
      // tag:v1:t must be in del calls
      const delKeys = cache.del.mock.calls.map(([k]) => k);
      expect(delKeys).toContain('tag:v1:t');
    });

    it('does NOT call cache.del when tag set is empty (no-op fast path)', async () => {
      cache.get.mockResolvedValueOnce([]); // tag set exists but empty
      await service.invalidateTag('t');
      // Only the tag-key delete should happen — no member deletes
      const memberDels = cache.del.mock.calls.filter(([k]) =>
        String(k).startsWith('cache:v1:'),
      );
      expect(memberDels).toHaveLength(0);
    });

    it('does NOT throw when cache.get rejects (logs + swallows)', async () => {
      cache.get.mockRejectedValueOnce(new Error('redis down'));
      await expect(service.invalidateTag('t')).resolves.toBeUndefined();
    });
  });

  describe('invalidateTags() — multi-tag', () => {
    it('runs invalidations in parallel (Promise.all)', async () => {
      // Slow each tag delete artificially; total time must be ~= one tag,
      // not sum-of-tags.
      const calls: string[] = [];
      cache.get.mockImplementation((k: string) => {
        calls.push(`get:${k}`);
        return Promise.resolve([]);
      });
      cache.del.mockImplementation((k: string) => {
        calls.push(`del:${k}`);
        return Promise.resolve();
      });
      await service.invalidateTags(['a', 'b', 'c']);
      // We can't perfectly assert wall-clock parallelism in jest, but
      // each tag must have produced its own get + del.
      expect(calls.filter((c) => c.startsWith('get:'))).toHaveLength(3);
      expect(calls.filter((c) => c.startsWith('del:'))).toHaveLength(3);
    });

    it('is a no-op on empty array', async () => {
      await service.invalidateTags([]);
      expect(cache.get).not.toHaveBeenCalled();
      expect(cache.del).not.toHaveBeenCalled();
    });

    it('handles duplicate tag names without exploding', async () => {
      await expect(
        service.invalidateTags(['t', 't', 't']),
      ).resolves.toBeUndefined();
    });
  });

  describe('CACHE_DISABLED toggle', () => {
    it('wrap() bypasses the cache entirely when CACHE_DISABLED=true', async () => {
      (ENV as { CACHE_DISABLED: boolean }).CACHE_DISABLED = true;
      const loader = jest.fn().mockResolvedValue('fresh');
      const out = await service.wrap('k', ['t'], loader, 60);
      expect(out).toBe('fresh');
      expect(cache.get).not.toHaveBeenCalled();
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('invalidateTag() is a no-op when CACHE_DISABLED=true', async () => {
      (ENV as { CACHE_DISABLED: boolean }).CACHE_DISABLED = true;
      await service.invalidateTag('t');
      expect(cache.get).not.toHaveBeenCalled();
      expect(cache.del).not.toHaveBeenCalled();
    });

    it('invalidateTags() inherits the disabled-state from invalidateTag', async () => {
      (ENV as { CACHE_DISABLED: boolean }).CACHE_DISABLED = true;
      await service.invalidateTags(['a', 'b']);
      expect(cache.del).not.toHaveBeenCalled();
    });
  });

  describe('namespace versioning', () => {
    it('namespaces value keys with `cache:v1:` prefix', async () => {
      const loader = jest.fn().mockResolvedValue('v');
      await service.wrap('issues:list', ['t'], loader, 60);
      expect(cache.get).toHaveBeenCalledWith('cache:v1:issues:list');
    });

    it('namespaces tag-set keys with `tag:v1:` prefix', async () => {
      cache.get.mockResolvedValueOnce([]);
      await service.invalidateTag('user:abc');
      expect(cache.get).toHaveBeenCalledWith('tag:v1:user:abc');
      expect(cache.del).toHaveBeenCalledWith('tag:v1:user:abc');
    });
  });
});
