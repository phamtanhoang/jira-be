import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { ENV } from '@/core/constants';

/**
 * Tag-based cache layer on top of cache-manager. cache-manager v6 doesn't
 * ship native tags, so we maintain a parallel set of keys per tag and
 * invalidate by reading the set then deleting both the keyed entries and
 * the set itself.
 *
 * Naming: `cache:v1:<namespace>:<key>` for values, `tag:v1:<tag>` for tag
 * sets. Bumping the `v1` prefix is the canonical "purge everything" lever.
 *
 * When `CACHE_DISABLED=1`, every method becomes a no-op (reads return
 * `undefined`, writes are dropped). Useful when stale data is suspected
 * and you need to verify the cache is the cause without touching code.
 */
@Injectable()
export class CacheTagsService {
  private readonly logger = new Logger(CacheTagsService.name);

  constructor(@Inject(CACHE_MANAGER) private cache: Cache) {}

  /**
   * Read-through helper. Returns the cached value if present, otherwise
   * runs `loader`, stores the result under all `tags`, and returns it.
   */
  async wrap<T>(
    key: string,
    tags: string[],
    loader: () => Promise<T>,
    ttlSec?: number,
  ): Promise<T> {
    if (ENV.CACHE_DISABLED) return loader();
    const cacheKey = this.namespacedKey(key);
    try {
      const hit = await this.cache.get<T>(cacheKey);
      if (hit !== undefined && hit !== null) return hit;
    } catch (err) {
      // A faulty cache must not turn into a 500 — fall through to the loader.
      this.logger.warn(
        `cache read failed for ${cacheKey}: ${stringifyErr(err)}`,
      );
      return loader();
    }

    const value = await loader();
    void this.set(cacheKey, value, tags, ttlSec);
    return value;
  }

  /**
   * Drop every cached entry tagged with `tag`. Mutations call this once per
   * affected entity (issue ID, project ID, workspace ID).
   */
  async invalidateTag(tag: string): Promise<void> {
    if (ENV.CACHE_DISABLED) return;
    const tagKey = this.tagKey(tag);
    try {
      const members = await this.cache.get<string[]>(tagKey);
      if (members && members.length > 0) {
        await Promise.all(
          members.map((k) => this.cache.del(k).catch(() => null)),
        );
      }
      await this.cache.del(tagKey);
    } catch (err) {
      this.logger.warn(
        `cache invalidate failed for ${tag}: ${stringifyErr(err)}`,
      );
    }
  }

  async invalidateTags(tags: string[]): Promise<void> {
    await Promise.all(tags.map((t) => this.invalidateTag(t)));
  }

  private async set<T>(
    cacheKey: string,
    value: T,
    tags: string[],
    ttlSec?: number,
  ): Promise<void> {
    const ttlMs = (ttlSec ?? ENV.CACHE_TTL_DEFAULT) * 1000;
    try {
      await this.cache.set(cacheKey, value, ttlMs);
      // Append the cache key into each tag's member list. We re-read +
      // re-write on every set; for low write rates this is fine. If a tag
      // grows beyond a few hundred members, swap to Redis SADD natively.
      await Promise.all(
        tags.map(async (tag) => {
          const tk = this.tagKey(tag);
          const existing = (await this.cache.get<string[]>(tk)) ?? [];
          if (!existing.includes(cacheKey)) {
            await this.cache.set(tk, [...existing, cacheKey], ttlMs * 2);
          }
        }),
      );
    } catch (err) {
      this.logger.warn(
        `cache write failed for ${cacheKey}: ${stringifyErr(err)}`,
      );
    }
  }

  private namespacedKey(key: string): string {
    return `cache:v1:${key}`;
  }

  private tagKey(tag: string): string {
    return `tag:v1:${tag}`;
  }
}

function stringifyErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
