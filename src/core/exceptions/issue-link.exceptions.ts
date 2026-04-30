import { HttpStatus } from '@nestjs/common';
import { MSG } from '@/core/constants';
import { BaseAppException } from './base-app.exception';

export class IssueLinkNotFoundException extends BaseAppException {
  constructor(message: string = MSG.ERROR.ISSUE_LINK_NOT_FOUND) {
    super(message, 'ISSUE_LINK_NOT_FOUND', HttpStatus.NOT_FOUND);
  }
}

/**
 * Thrown when caller tries to link an issue to itself. 400 — caller mistake,
 * not a missing resource.
 */
export class IssueLinkSelfException extends BaseAppException {
  constructor(message: string = MSG.ERROR.ISSUE_LINK_SELF) {
    super(message, 'ISSUE_LINK_SELF', HttpStatus.BAD_REQUEST);
  }
}

/**
 * Thrown on duplicate (sourceId, targetId, type) — Prisma P2002. 409 conflict
 * is the right shape: the request was valid, the state already satisfies it.
 */
export class IssueLinkConflictException extends BaseAppException {
  constructor(message: string = MSG.ERROR.ISSUE_LINK_EXISTS) {
    super(message, 'ISSUE_LINK_EXISTS', HttpStatus.CONFLICT);
  }
}
