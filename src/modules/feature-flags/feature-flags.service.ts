import { createHash } from 'crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { FeatureFlag, User, Role } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { MSG } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { AdminAuditService } from '@/modules/admin-audit/admin-audit.service';
import { CreateFlagDto, UpdateFlagDto } from './dto';

type FlagConditions = {
  roles?: Role[];
  emails?: string[];
  workspaceIds?: string[];
};

/**
 * Per-instance evaluator cache — flags rarely change, polling every render
 * shouldn't hit the DB. Flush on any write.
 */
const CACHE_TTL_MS = 30_000;

@Injectable()
export class FeatureFlagsService {
  constructor(
    private prisma: PrismaService,
    private audit: AdminAuditService,
  ) {}

  private cache: { flags: FeatureFlag[]; expiresAt: number } | null = null;

  private invalidateCache() {
    this.cache = null;
  }

  private async loadFlags(): Promise<FeatureFlag[]> {
    if (this.cache && Date.now() < this.cache.expiresAt) {
      return this.cache.flags;
    }
    const flags = await this.prisma.featureFlag.findMany({
      orderBy: { key: 'asc' },
    });
    this.cache = { flags, expiresAt: Date.now() + CACHE_TTL_MS };
    return flags;
  }

  async list() {
    return this.prisma.featureFlag.findMany({
      orderBy: { key: 'asc' },
    });
  }

  async create(dto: CreateFlagDto, creatorId: string) {
    const existing = await this.prisma.featureFlag.findUnique({
      where: { key: dto.key },
      select: { id: true },
    });
    if (existing) throw new ConflictException(MSG.ERROR.FLAG_KEY_EXISTS);

    const flag = await this.prisma.featureFlag.create({
      data: {
        key: dto.key,
        name: dto.name,
        description: dto.description,
        enabled: dto.enabled ?? false,
        rolloutPercentage: dto.rolloutPercentage ?? 0,
        conditions: (dto.conditions as Prisma.InputJsonValue) ?? undefined,
        createdById: creatorId,
      },
    });
    this.invalidateCache();
    this.audit.log(creatorId, 'FLAG_CREATE', {
      target: flag.id,
      targetType: 'FeatureFlag',
      payload: { key: flag.key },
    });
    return { message: MSG.SUCCESS.FLAG_CREATED, flag };
  }

  async update(id: string, dto: UpdateFlagDto, actorId: string) {
    await this.assertExists(id);
    const flag = await this.prisma.featureFlag.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        enabled: dto.enabled,
        rolloutPercentage: dto.rolloutPercentage,
        conditions:
          dto.conditions === undefined
            ? undefined
            : (dto.conditions as Prisma.InputJsonValue),
      },
    });
    this.invalidateCache();
    this.audit.log(actorId, 'FLAG_UPDATE', {
      target: flag.id,
      targetType: 'FeatureFlag',
      payload: { key: flag.key, update: dto },
    });
    return { message: MSG.SUCCESS.FLAG_UPDATED, flag };
  }

  async remove(id: string, actorId: string) {
    await this.assertExists(id);
    const flag = await this.prisma.featureFlag.delete({ where: { id } });
    this.invalidateCache();
    this.audit.log(actorId, 'FLAG_DELETE', {
      target: flag.id,
      targetType: 'FeatureFlag',
      payload: { key: flag.key },
    });
    return { message: MSG.SUCCESS.FLAG_DELETED };
  }

  /**
   * Return `Record<key, boolean>` for the given user. Never throws — unknown
   * flags are simply absent from the result.
   */
  async evaluateForUser(
    user: User & { workspaceMembers?: { workspaceId: string }[] },
  ): Promise<Record<string, boolean>> {
    const flags = await this.loadFlags();
    const out: Record<string, boolean> = {};
    for (const flag of flags) {
      out[flag.key] = evaluate(flag, user);
    }
    return out;
  }

  private async assertExists(id: string) {
    const exists = await this.prisma.featureFlag.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException(MSG.ERROR.FLAG_NOT_FOUND);
  }
}

function evaluate(
  flag: FeatureFlag,
  user: User & { workspaceMembers?: { workspaceId: string }[] },
): boolean {
  if (!flag.enabled) return false;

  const conditions = (flag.conditions as FlagConditions | null) ?? {};

  // Explicit include lists — ANY match wins.
  if (conditions.emails?.includes(user.email)) return true;
  if (conditions.roles?.includes(user.role)) return true;
  if (conditions.workspaceIds && user.workspaceMembers) {
    const userWorkspaceIds = user.workspaceMembers.map((m) => m.workspaceId);
    if (conditions.workspaceIds.some((wid) => userWorkspaceIds.includes(wid))) {
      return true;
    }
  }

  // If any explicit include list is set but the user didn't match, the
  // percentage rollout still applies as a secondary filter.
  if (flag.rolloutPercentage <= 0) {
    // No rollout + no explicit match → false
    const hasExplicitList =
      (conditions.roles?.length ?? 0) > 0 ||
      (conditions.emails?.length ?? 0) > 0 ||
      (conditions.workspaceIds?.length ?? 0) > 0;
    if (hasExplicitList) return false;
    return false;
  }
  if (flag.rolloutPercentage >= 100) return true;
  return bucket(user.id, flag.key) < flag.rolloutPercentage;
}

/**
 * Deterministic 0–99 bucket from (userId, flagKey) so the same user always
 * gets the same decision for a given flag.
 */
function bucket(userId: string, flagKey: string): number {
  const h = createHash('sha256').update(`${userId}::${flagKey}`).digest();
  const n = h.readUInt32BE(0);
  return n % 100;
}
