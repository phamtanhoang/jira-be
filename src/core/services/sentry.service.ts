import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { ENV } from '@/core/constants';

/**
 * Thin wrapper around @sentry/nestjs so the filter/service code stays framework-
 * agnostic. Every method is a no-op when:
 *   - SENTRY_DSN is missing (dev without a Sentry account), OR
 *   - NODE_ENV !== 'production' (local dev should never burn the quota).
 *
 * The actual Sentry.init() call lives in main.ts and uses the same guard;
 * this flag mirrors it so capture calls short-circuit before reaching the SDK.
 */
@Injectable()
export class SentryService {
  private readonly logger = new Logger(SentryService.name);
  private readonly enabled =
    !!ENV.SENTRY_DSN && process.env.NODE_ENV === 'production';

  captureException(
    exception: unknown,
    context?: {
      user?: { id: string; email: string };
      extra?: Record<string, unknown>;
    },
  ): string | undefined {
    if (!this.enabled) return undefined;
    try {
      return Sentry.captureException(exception, {
        user: context?.user,
        extra: context?.extra,
      });
    } catch (err) {
      this.logger.debug(`Sentry capture skipped: ${String(err)}`);
      return undefined;
    }
  }
}
