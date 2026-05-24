import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { ENV } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';

/**
 * System health probes — extracted from the original `AdminService` to keep
 * each unit narrow. Two surfaces:
 *
 * - `getHealth()` — admin-only, rich detail (latencies, runtime, mail/sentry
 *   wiring config). Used by `/admin/health`.
 * - `getPublicHealth()` — no auth, leak-free, used by `/health` for external
 *   uptime monitors (Better Stack, UptimeRobot).
 *
 * Each probe is wrapped in try/catch so one failed dependency doesn't fail
 * the whole call.
 */
@Injectable()
export class AdminHealthService {
  constructor(
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cache: Cache,
  ) {}

  async getHealth() {
    const startedAt = Date.now();

    const dbProbe = async (): Promise<{
      ok: boolean;
      latencyMs: number;
      error?: string;
    }> => {
      const t = Date.now();
      try {
        await this.prisma.$queryRaw`SELECT 1`;
        return { ok: true, latencyMs: Date.now() - t };
      } catch (err) {
        return { ok: false, latencyMs: Date.now() - t, error: String(err) };
      }
    };

    const supabaseProbe = async (): Promise<{
      configured: boolean;
      ok: boolean;
      error?: string;
    }> => {
      if (!ENV.SUPABASE_URL || !ENV.SUPABASE_SERVICE_KEY) {
        return { configured: false, ok: false };
      }
      try {
        const res = await fetch(`${ENV.SUPABASE_URL}/auth/v1/health`, {
          headers: { apikey: ENV.SUPABASE_SERVICE_KEY },
          signal: AbortSignal.timeout(3000),
        });
        return { configured: true, ok: res.ok };
      } catch (err) {
        return { configured: true, ok: false, error: String(err) };
      }
    };

    const cacheProbe = async (): Promise<{
      configured: boolean;
      ok: boolean;
      latencyMs: number;
      mode: 'redis' | 'memory' | 'disabled';
      error?: string;
    }> => {
      const t = Date.now();
      if (ENV.CACHE_DISABLED) {
        return { configured: false, ok: true, latencyMs: 0, mode: 'disabled' };
      }
      const mode: 'redis' | 'memory' = ENV.REDIS_URL ? 'redis' : 'memory';
      try {
        const probeKey = '__health_probe__';
        await this.cache.set(probeKey, '1', 1000);
        const v = await this.cache.get<string>(probeKey);
        await this.cache.del(probeKey);
        return {
          configured: true,
          ok: v === '1',
          latencyMs: Date.now() - t,
          mode,
        };
      } catch (err) {
        return {
          configured: true,
          ok: false,
          latencyMs: Date.now() - t,
          mode,
          error: String(err),
        };
      }
    };

    const [db, supabase, cache] = await Promise.all([
      dbProbe(),
      supabaseProbe(),
      cacheProbe(),
    ]);

    const mem = process.memoryUsage();
    const memoryMB = Math.round((mem.rss / 1024 / 1024) * 10) / 10;

    return {
      checkedAt: new Date().toISOString(),
      checkDurationMs: Date.now() - startedAt,
      db,
      // Resend has no cheap public health endpoint — report config-only state.
      mail: {
        configured: !!ENV.RESEND_API_KEY,
        from: ENV.MAIL_FROM || null,
      },
      supabase,
      cache,
      sentry: {
        configured: !!ENV.SENTRY_DSN,
        active: !!ENV.SENTRY_DSN && ENV.IS_PRODUCTION,
      },
      runtime: {
        nodeVersion: process.version,
        uptimeSec: Math.round(process.uptime()),
        memoryMB,
        env: ENV.NODE_ENV,
      },
    };
  }

  /**
   * Lightweight public health check for external uptime monitors. Doesn't
   * leak secrets, runtime details, or auth-required data — just enough to
   * say "service is alive".
   *
   * Status semantics:
   * - "ok"        — DB reachable; if cache is configured it must also be ok.
   * - "degraded"  — DB ok, cache configured but failing (still serving traffic).
   * - "down"      — DB unreachable. Caller treats as failure.
   */
  /**
   * Liveness probe — designed to be HIT EVERY 30s by Docker healthcheck.
   * To avoid keeping the Neon free-tier compute alive forever, we DO NOT
   * query the database here. Process responsiveness is enough — if BE
   * has crashed, this whole HTTP handler never runs.
   *
   * Real DB liveness check still lives on the admin-only `GET /admin/health`
   * (in `AdminHealthService.getHealth()`) which probes DB + cache fully.
   * That endpoint is rare (only opened by admins) so it's fine to query.
   */
  getPublicHealth(): {
    status: 'ok';
    timestamp: string;
    uptimeSec: number;
  } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
    };
  }
}
