import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';
import { Global, Logger, Module } from '@nestjs/common';
import { ENV } from '@/core/constants';
import { CacheTagsService } from './cache-tags.service';

const logger = new Logger('CacheModule');

/**
 * Global cache module. When `REDIS_URL` is set the store is Redis; otherwise
 * we fall back to cache-manager's in-memory map so dev / unit tests don't
 * need a Redis container running. `CACHE_DISABLED=1` bypasses the layer
 * entirely (handled inside `CacheTagsService`).
 */
@Global()
@Module({
  imports: [
    NestCacheModule.registerAsync({
      isGlobal: true,
      useFactory: async () => {
        const ttlSeconds = ENV.CACHE_TTL_DEFAULT;

        if (!ENV.REDIS_URL) {
          logger.log(
            `REDIS_URL not set — using in-memory cache (TTL ${ttlSeconds}s).`,
          );
          return { ttl: ttlSeconds * 1000 };
        }

        // Lazy-load the redis store so non-redis deployments don't pay the
        // resolve cost. cache-manager-redis-yet ships ESM exports — the
        // dynamic import keeps both module systems happy.
        const { redisStore } = await import('cache-manager-redis-yet');
        const store = await redisStore({
          url: ENV.REDIS_URL,
          ttl: ttlSeconds * 1000,
        });
        logger.log(`Connected to Redis at ${maskUrl(ENV.REDIS_URL)}.`);
        return { store, ttl: ttlSeconds * 1000 };
      },
    }),
  ],
  providers: [CacheTagsService],
  exports: [CacheTagsService, NestCacheModule],
})
export class AppCacheModule {}

// Strip credentials from a Redis URL before logging — keeps secrets out of
// the request log even though boot-time logs are admin-visible.
function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '<invalid>';
  }
}
