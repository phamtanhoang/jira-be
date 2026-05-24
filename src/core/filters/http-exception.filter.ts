import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { LogLevel } from '@prisma/client';
import { Request, Response } from 'express';
import { MSG } from '@/core/constants';
import { BaseAppException } from '@/core/exceptions';
import { SentryService } from '@/core/services/sentry.service';
import { AuthUser } from '@/core/types';
import {
  sanitize,
  shouldDropRequestBody,
  TIMEZONE_HEADER,
  convertDateToTimezone,
  resolveTimezone,
} from '@/core/utils';
import {
  EventLoggerService,
  EVENTS,
  type EventName,
} from '@/modules/logs/event-logger.service';

@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(
    private events: EventLoggerService,
    private sentryService: SentryService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request & { user?: AuthUser }>();
    const response = ctx.getResponse<Response>();

    const timezone = resolveTimezone(
      request.headers[TIMEZONE_HEADER] as string | undefined,
    );

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : MSG.ERROR.INTERNAL_SERVER_ERROR;

    const errorMessage =
      typeof message === 'string'
        ? message
        : ((message as { message?: string | string[] }).message ?? message);

    const errorCode =
      exception instanceof BaseAppException ? exception.errorCode : undefined;

    // Fire-and-forget — never affect the response.
    this.safeLog(request, status, exception);

    response.status(status).json({
      statusCode: status,
      message: errorMessage,
      ...(errorCode ? { errorCode } : {}),
      timestamp: convertDateToTimezone(new Date(), timezone),
    });
  }

  /**
   * Event-driven logging. Only emit when the failure is actually worth a
   * row in the DB:
   *   - 5xx   → `error.5xx` (always; Sentry too)
   *   - 403   → `authz.denied` (security signal)
   *   - 429   → `ratelimit.hit` (operational signal)
   *
   * Everything else (404, validation 400, 401 auth probes, etc.) is
   * normal protocol traffic and stays out of the DB. If you need ad-hoc
   * debugging of those, look at `docker logs` — every exception still
   * goes through NestJS's stdout logger.
   */
  private safeLog(
    request: Request & { user?: AuthUser },
    status: number,
    exception: unknown,
  ) {
    try {
      const event = pickEventFor(status, exception);
      if (!event) return;

      const url = request.originalUrl || request.url;
      const user = request.user;
      const errorMessage =
        exception instanceof Error ? exception.message : String(exception);
      const errorStack =
        exception instanceof Error ? exception.stack : undefined;

      let sentryEventId: string | undefined;
      if (status >= 500) {
        sentryEventId = this.sentryService.captureException(exception, {
          user: user ? { id: user.id, email: user.email } : undefined,
          extra: { url, method: request.method, statusCode: status },
        });
      }

      // For 5xx we keep the inbound body (helps debugging server crashes).
      // For 4xx events we don't — the URL + status is enough.
      const requestBody =
        status >= 500 && !shouldDropRequestBody(url)
          ? (sanitize(request.body) as never)
          : undefined;

      this.events.log(event, {
        level: status >= 500 ? LogLevel.ERROR : LogLevel.WARN,
        method: request.method,
        url,
        route: (request.route as { path?: string } | undefined)?.path,
        statusCode: status,
        userId: user?.id ?? null,
        userEmail: user?.email ?? null,
        ip: request.ip ?? null,
        userAgent: request.headers['user-agent'] ?? null,
        requestBody,
        errorMessage,
        errorStack: errorStack ?? null,
        sentryEventId: sentryEventId ?? null,
      });
    } catch (err) {
      this.logger.error('Failed to log exception', err as Error);
    }
  }
}

// HttpStatus values cast to plain number for comparison — eslint's
// `no-unsafe-enum-comparison` rule fires otherwise because we receive
// the `status` arg as a plain `number`, not the `HttpStatus` enum type.
const STATUS_FORBIDDEN: number = HttpStatus.FORBIDDEN;
const STATUS_TOO_MANY_REQUESTS: number = HttpStatus.TOO_MANY_REQUESTS;

function pickEventFor(status: number, exception: unknown): EventName | null {
  if (status >= 500) return EVENTS.ERROR_5XX;
  if (status === STATUS_FORBIDDEN) return EVENTS.AUTHZ_DENIED;
  if (status === STATUS_TOO_MANY_REQUESTS) return EVENTS.RATELIMIT_HIT;
  // 401 / 404 / 400 / 422 / etc. → not interesting at this scope, skip.
  // We still surface them via stdout, just not via a DB row.
  // (kept the `exception` param because we may extend this later to
  // recognise specific BaseAppException subclasses.)
  void exception;
  return null;
}
