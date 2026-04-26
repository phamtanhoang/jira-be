import { Inject, Injectable, Optional } from '@nestjs/common';
import { ModuleRef, Reflector } from '@nestjs/core';
import {
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import type { Request } from 'express';
import { ThrottleOverridesService } from '@/modules/throttle-overrides/throttle-overrides.service';

/**
 * ThrottlerGuard that consults `ThrottleOverride` rows to bypass or scale
 * the limit on a per-target basis. Target keys are derived as:
 *   - `user:UUID` if the request has been authenticated by JwtAuthGuard
 *   - `ip:ADDR`   for anonymous traffic
 *
 * When `bypass = true` we short-circuit `handleRequest` so the counter never
 * even increments. When `bypass = false` and `multiplier ≠ 1` we inflate the
 * limit fed to the parent.
 *
 * The override service is resolved lazily via ModuleRef to avoid a circular
 * dependency at app boot (ThrottleOverridesModule → guard → service).
 */
@Injectable()
export class OverridableThrottlerGuard extends ThrottlerGuard {
  private overrides?: ThrottleOverridesService;

  constructor(
    @Inject('THROTTLER:MODULE_OPTIONS') options: ThrottlerModuleOptions,
    storageService: ThrottlerStorage,
    reflector: Reflector,
    @Optional() private moduleRef?: ModuleRef,
  ) {
    super(options, storageService, reflector);
  }

  protected async handleRequest(
    requestProps: Parameters<ThrottlerGuard['handleRequest']>[0],
  ): Promise<boolean> {
    const ctx = requestProps.context;
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { user?: { id?: string } }>();
    const userId = req.user?.id;
    const ip = (req.ip ?? req.headers['x-forwarded-for'] ?? '').toString();
    const target = userId ? `user:${userId}` : `ip:${ip.split(',')[0].trim()}`;

    const override = await this.lookupOverride(target);

    if (override?.bypass) return true; // skip throttling entirely

    if (override && override.multiplier !== 1) {
      return super.handleRequest({
        ...requestProps,
        limit: Math.max(
          1,
          Math.floor(requestProps.limit * override.multiplier),
        ),
      });
    }

    return super.handleRequest(requestProps);
  }

  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const r = req as unknown as Request & { user?: { id?: string } };
    const key = r.user?.id
      ? `user:${r.user.id}`
      : `ip:${(r.ip ?? '').toString()}`;
    return Promise.resolve(key);
  }

  private async lookupOverride(target: string) {
    if (!this.overrides && this.moduleRef) {
      try {
        this.overrides = this.moduleRef.get(ThrottleOverridesService, {
          strict: false,
        });
      } catch {
        this.overrides = undefined;
      }
    }
    if (!this.overrides) return null;
    return this.overrides.getOverride(target).catch(() => null);
  }
}
