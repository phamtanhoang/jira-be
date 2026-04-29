import { HttpStatus } from '@nestjs/common';
import { MSG } from '@/core/constants';
import { BaseAppException } from './base-app.exception';

export class ProjectAccessDeniedException extends BaseAppException {
  constructor(message: string = MSG.ERROR.NOT_PROJECT_MEMBER) {
    super(message, 'PROJECT_ACCESS_DENIED', HttpStatus.FORBIDDEN);
  }
}
