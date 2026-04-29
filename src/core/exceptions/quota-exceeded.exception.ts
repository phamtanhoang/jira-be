import { HttpStatus } from '@nestjs/common';
import { BaseAppException } from './base-app.exception';

/**
 * Thrown when a workspace/project hits a quota cap (projects, members,
 * storage). Pass the matching `MSG.ERROR.QUOTA_*` constant as `message`.
 */
export class QuotaExceededException extends BaseAppException {
  constructor(message: string) {
    super(message, 'QUOTA_EXCEEDED', HttpStatus.FORBIDDEN);
  }
}
