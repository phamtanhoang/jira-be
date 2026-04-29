import { HttpStatus } from '@nestjs/common';
import { MSG } from '@/core/constants';
import { BaseAppException } from './base-app.exception';

export class WorkspaceAccessDeniedException extends BaseAppException {
  constructor(message: string = MSG.ERROR.NOT_WORKSPACE_MEMBER) {
    super(message, 'WORKSPACE_ACCESS_DENIED', HttpStatus.FORBIDDEN);
  }
}
