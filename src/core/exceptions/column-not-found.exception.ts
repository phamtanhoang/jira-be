import { HttpStatus } from '@nestjs/common';
import { MSG } from '@/core/constants';
import { BaseAppException } from './base-app.exception';

export class ColumnNotFoundException extends BaseAppException {
  constructor(message: string = MSG.ERROR.COLUMN_NOT_FOUND) {
    super(message, 'COLUMN_NOT_FOUND', HttpStatus.NOT_FOUND);
  }
}
