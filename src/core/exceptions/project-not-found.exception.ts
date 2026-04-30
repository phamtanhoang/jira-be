import { HttpStatus } from '@nestjs/common';
import { MSG } from '@/core/constants';
import { BaseAppException } from './base-app.exception';

export class ProjectNotFoundException extends BaseAppException {
  constructor(message: string = MSG.ERROR.PROJECT_NOT_FOUND) {
    super(message, 'PROJECT_NOT_FOUND', HttpStatus.NOT_FOUND);
  }
}
