import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { AuthUser } from '@/core/types';
import {
  EventLoggerService,
  EVENTS,
} from '@/modules/logs/event-logger.service';

/**
 * Slow-request watchdog (the only thing this interceptor is responsible
 * for since the event-log refactor).
 *
 * Before: every successful request → 1 row in RequestLog. Most rows were
 * polling traffic that nobody ever read. Result: 10k+ rows/day on a small
 * tenant.
 *
 * After: we only emit a `perf.slow_request` event when latency exceeds
 * `SLOW_REQUEST_THRESHOLD_MS`. Business events live in dedicated emit
 * sites (auth controller, etc.), not as a side effect of HTTP requests.
 * Access-log noise lives in `docker logs` / stdout, not in the DB.
 */
const SLOW_REQUEST_THRESHOLD_MS = 2000;

@Injectable()
export class RequestLoggerInterceptor implements NestInterceptor {
  constructor(private events: EventLoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: AuthUser }>();
    const response = http.getResponse<Response>();
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - start;
          if (duration < SLOW_REQUEST_THRESHOLD_MS) return;
          this.safeLogSlow(request, response, duration);
        },
      }),
    );
  }

  private safeLogSlow(
    request: Request & { user?: AuthUser },
    response: Response,
    duration: number,
  ) {
    try {
      const user = request.user;
      this.events.log(EVENTS.PERF_SLOW_REQUEST, {
        method: request.method,
        url: request.originalUrl || request.url,
        route: (request.route as { path?: string } | undefined)?.path,
        statusCode: response.statusCode,
        durationMs: duration,
        userId: user?.id ?? null,
        userEmail: user?.email ?? null,
        ip: request.ip ?? null,
        userAgent: request.headers['user-agent'] ?? null,
        metadata: { thresholdMs: SLOW_REQUEST_THRESHOLD_MS },
      });
    } catch {
      // Swallow — logging must never break the request.
    }
  }
}
