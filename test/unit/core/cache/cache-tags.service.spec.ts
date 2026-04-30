/**
 * Unit tests for CacheTagsService — wrap (read-through), invalidateTag,
 * kill switch behavior. No Redis / no Prisma — backed by an in-memory
 * `Cache` mock.
 */
// Tweakable kill switch for tests. The service reads `ENV.CACHE_DISABLED`
// at call time, so we mutate the constants module behind a jest.mock.
// Hoisted ahead of the imports below by jest's module loader.
jest.mock('@/core/constants', () => {
  const real = jest.requireActual('@/core/constants');
  return {
    ...real,
    ENV: { ...(real.ENV as Record<string, unknown>), CACHE_DISABLED: false },
  };
});

import { CacheTagsService } from '@/core/cache/cache-tags.service';
import { ENV } from '@/core/constants';

type CacheStore = Map<string, unknown>;

function makeMockCache(): {
  cache: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  store: CacheStore;
} {
  const store: CacheStore = new Map();
  return {
    store,
    cache: {
      get: jest.fn((key: string) => Promise.resolve(store.get(key))),
      set: jest.fn((key: string, value: unknown) => {
        store.set(key, value);
        return Promise.resolve();
      }),
      del: jest.fn((key: string) => {
        store.delete(key);
        return Promise.resolve();
      }),
    },
  };
}

function makeService(): {
  service: CacheTagsService;
  cache: ReturnType<typeof makeMockCache>['cache'];
  store: CacheStore;
} {
  const { cache, store } = makeMockCache();
  // Cast through unknown — test only depends on get/set/del being callable.
  const service = new CacheTagsService(cache as unknown as never);
  return { service, cache, store };
}

beforeEach(() => {
  (ENV as { CACHE_DISABLED: boolean }).CACHE_DISABLED = false;
});

describe('CacheTagsService.wrap', () => {
  it('runs loader on cache miss and caches the result', async () => {
    const { service, cache, store } = makeService();
    const loader = jest.fn(() => Promise.resolve({ value: 1 }));

    const result = await service.wrap('ws:list:user:abc', ['user:abc'], loader);

    expect(result).toEqual({ value: 1 });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cache.get).toHaveBeenCalledWith('cache:v1:ws:list:user:abc');
    // The set() call is intentionally fire-and-forget so the user request
    // doesn't wait on the cache write — flush microtasks before assertions.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(store.get('cache:v1:ws:list:user:abc')).toEqual({ value: 1 });
    // Tag membership recorded so future invalidate can find this key.
    expect(store.get('tag:v1:user:abc')).toEqual(['cache:v1:ws:list:user:abc']);
  });

  it('returns the cached value without calling loader on hit', async () => {
    const { service, store } = makeService();
    store.set('cache:v1:hit-key', 'cached!');

    const loader = jest.fn();
    const result = await service.wrap('hit-key', ['some-tag'], loader);

    expect(result).toBe('cached!');
    expect(loader).not.toHaveBeenCalled();
  });

  it('falls through to loader when cache read throws', async () => {
    const { service, cache } = makeService();
    cache.get.mockRejectedValueOnce(new Error('redis exploded'));
    const loader = jest.fn(() => Promise.resolve(42));

    const result = await service.wrap('flaky-key', ['tag-a'], loader);

    expect(result).toBe(42);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('skips cache entirely when ENV.CACHE_DISABLED is set', async () => {
    (ENV as { CACHE_DISABLED: boolean }).CACHE_DISABLED = true;
    const { service, cache } = makeService();
    const loader = jest.fn(() => Promise.resolve('fresh'));

    const result = await service.wrap('any-key', ['t'], loader);

    expect(result).toBe('fresh');
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cache.get).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });
});

describe('CacheTagsService.invalidateTag', () => {
  it('deletes every key in the tag set + the tag set itself', async () => {
    const { service, cache, store } = makeService();
    // Seed two cached entries under the same tag (simulate two prior wraps).
    store.set('cache:v1:k1', 'v1');
    store.set('cache:v1:k2', 'v2');
    store.set('tag:v1:user:abc', ['cache:v1:k1', 'cache:v1:k2']);

    await service.invalidateTag('user:abc');

    expect(cache.del).toHaveBeenCalledWith('cache:v1:k1');
    expect(cache.del).toHaveBeenCalledWith('cache:v1:k2');
    expect(cache.del).toHaveBeenCalledWith('tag:v1:user:abc');
    expect(store.has('cache:v1:k1')).toBe(false);
    expect(store.has('cache:v1:k2')).toBe(false);
    expect(store.has('tag:v1:user:abc')).toBe(false);
  });

  it('is a no-op when ENV.CACHE_DISABLED is set', async () => {
    (ENV as { CACHE_DISABLED: boolean }).CACHE_DISABLED = true;
    const { service, cache } = makeService();

    await service.invalidateTag('any-tag');

    expect(cache.get).not.toHaveBeenCalled();
    expect(cache.del).not.toHaveBeenCalled();
  });

  it('swallows backend errors so request paths never 500 on cache flake', async () => {
    const { service, cache } = makeService();
    cache.get.mockRejectedValueOnce(new Error('connection lost'));

    // Should NOT throw.
    await expect(service.invalidateTag('user:abc')).resolves.toBeUndefined();
  });
});
