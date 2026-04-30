import { HttpStatus } from '@nestjs/common';
import { MSG } from '@/core/constants';
import { BaseAppException } from './base-app.exception';

export class ShareTokenNotFoundException extends BaseAppException {
  constructor(message: string = MSG.ERROR.SHARE_TOKEN_NOT_FOUND) {
    super(message, 'SHARE_TOKEN_NOT_FOUND', HttpStatus.NOT_FOUND);
  }
}

export class ShareTokenExpiredException extends BaseAppException {
  constructor(message: string = MSG.ERROR.SHARE_TOKEN_EXPIRED) {
    super(message, 'SHARE_TOKEN_EXPIRED', HttpStatus.NOT_FOUND);
  }
}
