import { HttpStatus } from '@nestjs/common';
import { MSG } from '@/core/constants';
import { BaseAppException } from './base-app.exception';

export class InsufficientPermissionsException extends BaseAppException {
  constructor(message: string = MSG.ERROR.INSUFFICIENT_PERMISSIONS) {
    super(message, 'INSUFFICIENT_PERMISSIONS', HttpStatus.FORBIDDEN);
  }
}
