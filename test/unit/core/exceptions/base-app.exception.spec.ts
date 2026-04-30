/**
 * Unit tests for BaseAppException + canonical subclasses. Covers the
 * stable-errorCode contract that the FE branches on. If these break, the
 * FE error handling silently degrades (codes vanish from response JSON),
 * so it's worth a few cheap regression tests.
 */
import { HttpStatus } from '@nestjs/common';
import {
  BaseAppException,
  ColumnNotFoundException,
  InsufficientPermissionsException,
  IssueLinkConflictException,
  IssueLinkNotFoundException,
  IssueLinkSelfException,
  IssueNotFoundException,
  ProjectAccessDeniedException,
  ProjectNotFoundException,
  QuotaExceededException,
  ShareTokenExpiredException,
  ShareTokenNotFoundException,
  WorkspaceAccessDeniedException,
} from '@/core/exceptions';

describe('BaseAppException', () => {
  it('exposes errorCode property + status from constructor', () => {
    class TestEx extends BaseAppException {
      constructor() {
        super('TEST_MSG', 'TEST_CODE', HttpStatus.BAD_REQUEST);
      }
    }
    const ex = new TestEx();
    expect(ex.errorCode).toBe('TEST_CODE');
    expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST);

    // The response payload (what the global filter pulls from getResponse)
    // carries the same fields so AllExceptionsFilter can surface errorCode.
    const response = ex.getResponse() as Record<string, unknown>;
    expect(response.errorCode).toBe('TEST_CODE');
    expect(response.message).toBe('TEST_MSG');
    expect(response.statusCode).toBe(HttpStatus.BAD_REQUEST);
  });

  it('is detectable via instanceof — required for filter to extract code', () => {
    const ex = new IssueNotFoundException();
    expect(ex instanceof BaseAppException).toBe(true);
  });
});

describe('canonical exception subclasses', () => {
  // Status semantics matter: 404 NotFound vs 403 Forbidden vs 409 Conflict
  // shape FE's error handling differently. Lock the contract here.
  const cases: Array<{
    name: string;
    instance: BaseAppException;
    code: string;
    status: HttpStatus;
  }> = [
    {
      name: 'IssueNotFoundException',
      instance: new IssueNotFoundException(),
      code: 'ISSUE_NOT_FOUND',
      status: HttpStatus.NOT_FOUND,
    },
    {
      name: 'ProjectNotFoundException',
      instance: new ProjectNotFoundException(),
      code: 'PROJECT_NOT_FOUND',
      status: HttpStatus.NOT_FOUND,
    },
    {
      name: 'ColumnNotFoundException',
      instance: new ColumnNotFoundException(),
      code: 'COLUMN_NOT_FOUND',
      status: HttpStatus.NOT_FOUND,
    },
    {
      name: 'ShareTokenNotFoundException',
      instance: new ShareTokenNotFoundException(),
      code: 'SHARE_TOKEN_NOT_FOUND',
      status: HttpStatus.NOT_FOUND,
    },
    {
      name: 'ShareTokenExpiredException',
      instance: new ShareTokenExpiredException(),
      code: 'SHARE_TOKEN_EXPIRED',
      status: HttpStatus.NOT_FOUND,
    },
    {
      name: 'IssueLinkNotFoundException',
      instance: new IssueLinkNotFoundException(),
      code: 'ISSUE_LINK_NOT_FOUND',
      status: HttpStatus.NOT_FOUND,
    },
    {
      name: 'IssueLinkSelfException (400)',
      instance: new IssueLinkSelfException(),
      code: 'ISSUE_LINK_SELF',
      status: HttpStatus.BAD_REQUEST,
    },
    {
      name: 'IssueLinkConflictException (409)',
      instance: new IssueLinkConflictException(),
      code: 'ISSUE_LINK_EXISTS',
      status: HttpStatus.CONFLICT,
    },
    {
      name: 'WorkspaceAccessDeniedException',
      instance: new WorkspaceAccessDeniedException(),
      code: 'WORKSPACE_ACCESS_DENIED',
      status: HttpStatus.FORBIDDEN,
    },
    {
      name: 'ProjectAccessDeniedException',
      instance: new ProjectAccessDeniedException(),
      code: 'PROJECT_ACCESS_DENIED',
      status: HttpStatus.FORBIDDEN,
    },
    {
      name: 'InsufficientPermissionsException',
      instance: new InsufficientPermissionsException(),
      code: 'INSUFFICIENT_PERMISSIONS',
      status: HttpStatus.FORBIDDEN,
    },
    {
      name: 'QuotaExceededException',
      instance: new QuotaExceededException('QUOTA_PROJECTS_REACHED'),
      code: 'QUOTA_EXCEEDED',
      status: HttpStatus.FORBIDDEN,
    },
  ];

  it.each(cases)(
    '$name → errorCode=$code, status=$status',
    ({ instance, code, status }) => {
      expect(instance).toBeInstanceOf(BaseAppException);
      expect(instance.errorCode).toBe(code);
      expect(instance.getStatus()).toBe(status);
    },
  );

  it('accepts a custom message override (i18n-ready)', () => {
    const ex = new IssueNotFoundException('Custom translated message');
    const response = ex.getResponse() as Record<string, unknown>;
    expect(response.message).toBe('Custom translated message');
    // errorCode stays stable even when message changes.
    expect(ex.errorCode).toBe('ISSUE_NOT_FOUND');
  });
});
