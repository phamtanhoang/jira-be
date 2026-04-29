import { HttpStatus } from '@nestjs/common';
import { MSG } from '@/core/constants';
import { BaseAppException } from './base-app.exception';

export class IssueNotFoundException extends BaseAppException {
  constructor(message: string = MSG.ERROR.ISSUE_NOT_FOUND) {
    super(message, 'ISSUE_NOT_FOUND', HttpStatus.NOT_FOUND);
  }
}
