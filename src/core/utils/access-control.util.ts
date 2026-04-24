import { ForbiddenException } from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { MSG } from '@/core/constants';
import type { PrismaService } from '@/core/database/prisma.service';

/**
 * Standalone helper (no DI) for project-level access checks. Used by services
 * that can't import `ProjectsService` without creating a circular module graph
 * (boards, sprints, labels, attachments, comments, worklogs all eventually
 * depend on projects — the util lets them enforce project-member gating
 * without the dep).
 *
 * Access rule:
 *  - Workspace OWNER / ADMIN bypass project membership (they administer
 *    everything in their workspace).
 *  - All other workspace members must be explicit ProjectMember rows on the
 *    specific project to read / write its resources.
 *
 * Throws ForbiddenException with canonical MSG error codes on failure.
 */
export async function assertProjectAccess(
  prisma: PrismaService,
  workspaceId: string,
  projectId: string,
  userId: string,
): Promise<void> {
  const wsMember = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  if (!wsMember) {
    throw new ForbiddenException(MSG.ERROR.NOT_WORKSPACE_MEMBER);
  }
  if (
    wsMember.role === WorkspaceRole.OWNER ||
    wsMember.role === WorkspaceRole.ADMIN
  ) {
    return;
  }

  const pjMember = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
  });
  if (!pjMember) {
    throw new ForbiddenException(MSG.ERROR.NOT_PROJECT_MEMBER);
  }
}
