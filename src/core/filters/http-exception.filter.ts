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
import { SentryService } from '@/core/services/sentry.service';
import { AuthUser } from '@/core/types';
import {
  sanitize,
  shouldDropRequestBody,
  shouldSkipLogging,
  TIMEZONE_HEADER,
  convertDateToTimezone,
  resolveTimezone,
} from '@/core/utils';
import { LogsService } from '@/modules/logs/logs.service';

@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(
    private logsService: LogsService,
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

    // Fire-and-forget logging — must never affect the response
    this.safeLog(request, status, exception);

    response.status(status).json({
      statusCode: status,
      message: errorMessage,
      timestamp: convertDateToTimezone(new Date(), timezone),
    });
  }

  private safeLog(
    request: Request & { user?: AuthUser },
    status: number,
    exception: unknown,
  ) {
    try {
      const url = request.originalUrl || request.url;

      // Same skip policy as the success path: expected 4xx on auth-probe
      // routes shouldn't pollute the log. 5xx is always kept.
      if (shouldSkipLogging(request.method, url, status)) {
        return;
      }

      const user = request.user;
      const errorMessage =
        exception instanceof Error ? exception.message : String(exception);
      const errorStack =
        exception instanceof Error ? exception.stack : undefined;

      // Only non-4xx client errors go to Sentry — don't flood with validation
      // failures. Upstream quota is precious.
      let sentryEventId: string | undefined;
      if (status >= 500) {
        sentryEventId = this.sentryService.captureException(exception, {
          user: user ? { id: user.id, email: user.email } : undefined,
          extra: { url, method: request.method, statusCode: status },
        });
      }

      const requestBody = shouldDropRequestBody(url)
        ? null
        : (sanitize(request.body) as object);

      this.logsService.enqueue({
        level: status >= 500 ? LogLevel.ERROR : LogLevel.WARN,
        source: 'backend',
        method: request.method,
        url,
        route: (request.route as { path?: string } | undefined)?.path,
        statusCode: status,
        userId: user?.id,
        userEmail: user?.email,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
        requestBody: requestBody as never,
        requestQuery: sanitize(request.query) as never,
        errorMessage,
        errorStack,
        sentryEventId,
      });
    } catch (err) {
      this.logger.error('Failed to log exception', err as Error);
    }
  }
}
