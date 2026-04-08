import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { MSG } from '@/core/constants';
import {
  TIMEZONE_HEADER,
  convertDateToTimezone,
  resolveTimezone,
} from '@/core/utils';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
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

    response.status(status).json({
      statusCode: status,
      message: errorMessage,
      timestamp: convertDateToTimezone(new Date(), timezone),
    });
  }
}
