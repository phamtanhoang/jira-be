import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { LogLevel } from '@prisma/client';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { AuthUser } from '@/core/types';
import {
  sanitize,
  shouldDropRequestBody,
  shouldSkipLogging,
  shouldSkipResponseBody,
} from '@/core/utils';
import { LogsService } from '@/modules/logs/logs.service';

/**
 * Logs every successful request (and records duration).
 * Error path is handled by AllExceptionsFilter — this interceptor only
 * runs the `tap` branch for the success stream.
 *
 * Registered globally via APP_INTERCEPTOR in AppModule.
 */
@Injectable()
export class RequestLoggerInterceptor implements NestInterceptor {
  constructor(private logsService: LogsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: AuthUser }>();
    const response = http.getResponse<Response>();
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: (data: unknown) => {
          this.safeLog(request, response, data, start);
        },
      }),
    );
  }

  private safeLog(
    request: Request & { user?: AuthUser },
    response: Response,
    data: unknown,
    start: number,
  ) {
    try {
      const url = request.originalUrl || request.url;
      const user = request.user;

      // Drop noisy successful polls (me/refresh/app-info/admin stats/...)
      // and anything originating from admin UI. Failures still log unless
      // they're expected flow (auth 401 on refresh, etc.)
      if (
        shouldSkipLogging(request.method, url, response.statusCode, {
          origin: request.headers['x-origin'],
          role: user?.role,
        })
      ) {
        return;
      }

      const requestBody = shouldDropRequestBody(url)
        ? null
        : (sanitize(request.body) as object);

      const responseBody = shouldSkipResponseBody(url)
        ? null
        : (sanitize(data) as object);

      this.logsService.enqueue({
        level: LogLevel.INFO,
        source: 'backend',
        method: request.method,
        url,
        route: (request.route as { path?: string } | undefined)?.path,
        statusCode: response.statusCode,
        durationMs: Date.now() - start,
        userId: user?.id,
        userEmail: user?.email,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
        requestBody: requestBody as never,
        requestQuery: sanitize(request.query) as never,
        responseBody: responseBody as never,
      });
    } catch {
      // Swallow — logging must never break the request
    }
  }
}
