import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Base class for domain-specific exceptions.
 *
 * Extends NestJS HttpException so the existing global filter
 * (AllExceptionsFilter) keeps working unchanged. Adds a stable
 * machine-readable `errorCode` that the frontend can branch on
 * without parsing the (i18n) message string.
 */
export class BaseAppException extends HttpException {
  /**
   * Stable, machine-readable identifier (e.g. 'ISSUE_NOT_FOUND',
   * 'WORKSPACE_ACCESS_DENIED'). Safe for FE conditional logic;
   * never localized.
   */
  readonly errorCode: string;

  constructor(message: string, errorCode: string, status: HttpStatus) {
    super({ message, errorCode, statusCode: status }, status);
    this.errorCode = errorCode;
  }
}
