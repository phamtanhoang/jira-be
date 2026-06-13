/**
 * Unit tests for `assertProjectAccess` — the single helper that gates
 * read/write access to project-scoped resources (boards, issues,
 * sprints, comments, worklogs, labels, attachments).
 *
 * The decision tree this suite exercises:
 *
 *   not a workspace member        → 403 NOT_WORKSPACE_MEMBER
 *   workspace OWNER               → allow (bypass project check)
 *   workspace ADMIN               → allow (bypass project check)
 *   workspace MEMBER + project member (any role) → allow
 *   workspace MEMBER, no project membership      → 403 NOT_PROJECT_MEMBER
 *   workspace VIEWER + project member            → allow
 *   workspace VIEWER, no project membership      → 403 NOT_PROJECT_MEMBER
 *
 * The util is used ~40 times across services; a regression here silently
 * leaks access to other workspaces / projects, so it gets thorough
 * coverage with no shortcuts.
 */
import { ForbiddenException } from '@nestjs/common';
import { MSG } from '@/core/constants';
import { assertProjectAccess } from '@/core/utils/access-control.util';

const WS_ID = 'w0000000-0000-0000-0000-000000000001';
const PROJECT_ID = 'p0000000-0000-0000-0000-000000000001';
const USER_ID = 'u0000000-0000-0000-0000-000000000001';

function createMockPrisma() {
  return {
    workspaceMember: { findUnique: jest.fn() },
    projectMember: { findUnique: jest.fn() },
  };
}

describe('assertProjectAccess()', () => {
  let prisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    prisma = createMockPrisma();
  });

  describe('workspace gate', () => {
    it('throws Forbidden NOT_WORKSPACE_MEMBER when user is not in the workspace', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(
        assertProjectAccess(prisma as never, WS_ID, PROJECT_ID, USER_ID),
      ).rejects.toMatchObject({
        name: 'ForbiddenException',
        message: MSG.ERROR.NOT_WORKSPACE_MEMBER,
      });
      expect(prisma.projectMember.findUnique).not.toHaveBeenCalled();
    });

    it('queries workspaceMember with the right compound key', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      await assertProjectAccess(prisma as never, WS_ID, PROJECT_ID, USER_ID);
      expect(prisma.workspaceMember.findUnique).toHaveBeenCalledWith({
        where: { workspaceId_userId: { workspaceId: WS_ID, userId: USER_ID } },
      });
    });
  });

  describe('workspace OWNER / ADMIN bypass', () => {
    it.each(['OWNER', 'ADMIN'] as const)(
      'allows workspace %s without consulting projectMember',
      async (role) => {
        prisma.workspaceMember.findUnique.mockResolvedValue({ role });
        await expect(
          assertProjectAccess(prisma as never, WS_ID, PROJECT_ID, USER_ID),
        ).resolves.toBeUndefined();
        expect(prisma.projectMember.findUnique).not.toHaveBeenCalled();
      },
    );
  });

  describe('non-OWNER/ADMIN workspace members — project membership required', () => {
    it.each(['MEMBER', 'VIEWER'] as const)(
      'workspace %s without a ProjectMember row → NOT_PROJECT_MEMBER',
      async (wsRole) => {
        prisma.workspaceMember.findUnique.mockResolvedValue({ role: wsRole });
        prisma.projectMember.findUnique.mockResolvedValue(null);

        await expect(
          assertProjectAccess(prisma as never, WS_ID, PROJECT_ID, USER_ID),
        ).rejects.toMatchObject({
          name: 'ForbiddenException',
          message: MSG.ERROR.NOT_PROJECT_MEMBER,
        });
      },
    );

    it.each(['LEAD', 'ADMIN', 'DEVELOPER', 'VIEWER'] as const)(
      'workspace MEMBER with project role %s → allowed',
      async (pjRole) => {
        prisma.workspaceMember.findUnique.mockResolvedValue({
          role: 'MEMBER',
        });
        prisma.projectMember.findUnique.mockResolvedValue({ role: pjRole });

        await expect(
          assertProjectAccess(prisma as never, WS_ID, PROJECT_ID, USER_ID),
        ).resolves.toBeUndefined();
      },
    );

    it('queries projectMember with the right compound key', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ role: 'MEMBER' });
      prisma.projectMember.findUnique.mockResolvedValue({ role: 'DEVELOPER' });
      await assertProjectAccess(prisma as never, WS_ID, PROJECT_ID, USER_ID);
      expect(prisma.projectMember.findUnique).toHaveBeenCalledWith({
        where: { projectId_userId: { projectId: PROJECT_ID, userId: USER_ID } },
      });
    });
  });

  describe('cross-workspace isolation', () => {
    it('checks membership against the SUPPLIED workspaceId, not a derived one', async () => {
      // If the caller has a row in WS-B (via some other resource) but the
      // assertion is for WS-A, the lookup must use WS-A. This is the
      // canonical "user from WS-B tries to write PROJ-1 of WS-A" case.
      const FOREIGN_WS = 'w0000000-0000-0000-0000-00000000ffff';
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(
        assertProjectAccess(prisma as never, FOREIGN_WS, PROJECT_ID, USER_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.workspaceMember.findUnique).toHaveBeenCalledWith({
        where: {
          workspaceId_userId: { workspaceId: FOREIGN_WS, userId: USER_ID },
        },
      });
    });
  });

  describe('return shape', () => {
    it('resolves to undefined on success (void)', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue({ role: 'OWNER' });
      const ret = await assertProjectAccess(
        prisma as never,
        WS_ID,
        PROJECT_ID,
        USER_ID,
      );
      expect(ret).toBeUndefined();
    });

    it('rejects with ForbiddenException (not 404 / 401 / 500) on any denial', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);
      const promise = assertProjectAccess(
        prisma as never,
        WS_ID,
        PROJECT_ID,
        USER_ID,
      );
      await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('error propagation', () => {
    it('lets DB errors surface (does NOT swallow as a 403)', async () => {
      const dbErr = new Error('connection terminated');
      prisma.workspaceMember.findUnique.mockRejectedValueOnce(dbErr);
      await expect(
        assertProjectAccess(prisma as never, WS_ID, PROJECT_ID, USER_ID),
      ).rejects.toBe(dbErr);
    });
  });
});
