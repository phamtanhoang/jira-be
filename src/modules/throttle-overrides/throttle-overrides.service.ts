import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MSG, USER_SELECT_BASIC } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { AdminAuditService } from '@/modules/admin-audit/admin-audit.service';
import { CreateThrottleOverrideDto, UpdateThrottleOverrideDto } from './dto';

const ACTIVE_CACHE_TTL_MS = 30_000;

type CachedRow = {
  id: string;
  target: string;
  bypass: boolean;
  multiplier: number;
  expiresAt: Date | null;
};

/**
 * Manages per-target throttle overrides + caches them in-memory so the guard
 * lookup on every request is a Map.get(), not a DB roundtrip.
 *
 * Cache invalidates on every mutation. Reads bypass cache when stale (older
 * than 30s). The guard layer queries `getOverride()` synchronously and falls
 * back to the default policy when no override exists.
 */
@Injectable()
export class ThrottleOverridesService {
  private cache: Map<string, CachedRow> = new Map();
  private cacheLoadedAt = 0;

  constructor(
    private prisma: PrismaService,
    private audit: AdminAuditService,
  ) {}

  async list() {
    const rows = await this.prisma.throttleOverride.findMany({
      orderBy: { createdAt: 'desc' },
      include: { createdBy: USER_SELECT_BASIC },
    });
    return rows;
  }

  async create(actorId: string, dto: CreateThrottleOverrideDto) {
    try {
      const row = await this.prisma.throttleOverride.create({
        data: {
          target: dto.target,
          bypass: dto.bypass ?? false,
          multiplier: dto.multiplier ?? 1,
          reason: dto.reason ?? null,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          createdById: actorId,
        },
      });
      this.invalidateCache();
      this.audit.log(actorId, 'THROTTLE_OVERRIDE_CREATE', {
        target: row.id,
        targetType: 'ThrottleOverride',
        payload: {
          forTarget: row.target,
          bypass: row.bypass,
          multiplier: row.multiplier,
          reason: row.reason,
        },
      });
      return { message: MSG.SUCCESS.THROTTLE_OVERRIDE_CREATED, override: row };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('THROTTLE_OVERRIDE_EXISTS');
      }
      throw err;
    }
  }

  async update(actorId: string, id: string, dto: UpdateThrottleOverrideDto) {
    const exists = await this.prisma.throttleOverride.findUnique({
      where: { id },
    });
    if (!exists) throw new NotFoundException('THROTTLE_OVERRIDE_NOT_FOUND');

    const row = await this.prisma.throttleOverride.update({
      where: { id },
      data: {
        ...(dto.bypass !== undefined && { bypass: dto.bypass }),
        ...(dto.multiplier !== undefined && { multiplier: dto.multiplier }),
        ...(dto.reason !== undefined && { reason: dto.reason || null }),
        ...(dto.expiresAt !== undefined && {
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        }),
      },
    });
    this.invalidateCache();
    this.audit.log(actorId, 'THROTTLE_OVERRIDE_UPDATE', {
      target: row.id,
      targetType: 'ThrottleOverride',
      payload: {
        forTarget: row.target,
        from: {
          bypass: exists.bypass,
          multiplier: exists.multiplier,
        },
        to: { bypass: row.bypass, multiplier: row.multiplier },
      },
    });
    return { message: MSG.SUCCESS.THROTTLE_OVERRIDE_UPDATED, override: row };
  }

  async delete(actorId: string, id: string) {
    const exists = await this.prisma.throttleOverride.findUnique({
      where: { id },
    });
    if (!exists) throw new NotFoundException('THROTTLE_OVERRIDE_NOT_FOUND');
    await this.prisma.throttleOverride.delete({ where: { id } });
    this.invalidateCache();
    this.audit.log(actorId, 'THROTTLE_OVERRIDE_DELETE', {
      target: id,
      targetType: 'ThrottleOverride',
      payload: { forTarget: exists.target },
    });
    return { message: MSG.SUCCESS.THROTTLE_OVERRIDE_DELETED };
  }

  // Hot path — called on every request from the custom throttler guard.
  // Returns null when no row exists OR the row has expired. Cache is loaded
  // lazily on first call + refreshed on TTL.
  async getOverride(target: string): Promise<CachedRow | null> {
    await this.refreshCacheIfStale();
    const row = this.cache.get(target);
    if (!row) return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
    return row;
  }

  private async refreshCacheIfStale() {
    if (Date.now() - this.cacheLoadedAt < ACTIVE_CACHE_TTL_MS) return;
    const rows = await this.prisma.throttleOverride.findMany({
      where: {
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: {
        id: true,
        target: true,
        bypass: true,
        multiplier: true,
        expiresAt: true,
      },
    });
    this.cache = new Map(rows.map((r) => [r.target, r]));
    this.cacheLoadedAt = Date.now();
  }

  private invalidateCache() {
    this.cacheLoadedAt = 0;
  }
}
