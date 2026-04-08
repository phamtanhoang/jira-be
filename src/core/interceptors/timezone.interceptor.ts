import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable, map } from 'rxjs';
import {
  TIMEZONE_HEADER,
  resolveTimezone,
  transformDatesInResponse,
} from '@/core/utils';

@Injectable()
export class TimezoneInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const timezone = resolveTimezone(
      request.headers[TIMEZONE_HEADER] as string | undefined,
    );

    return next
      .handle()
      .pipe(map((data) => transformDatesInResponse(data, timezone)));
  }
}
