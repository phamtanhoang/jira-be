import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { ENV } from '@/core/constants';

/**
 * Thin wrapper around @sentry/nestjs so the filter/service code stays framework-
 * agnostic. When SENTRY_DSN is missing (dev without a Sentry account), every
 * method is a no-op — never throws.
 *
 * The actual Sentry.init() call lives in main.ts (it must run before
 * NestFactory.create).
 */
@Injectable()
export class SentryService {
  private readonly logger = new Logger(SentryService.name);
  private readonly enabled = !!ENV.SENTRY_DSN;

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
