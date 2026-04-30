import { Injectable } from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { USER_SELECT_FULL } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';

/**
 * Pure data-access layer for the project domain.
 *
 * - Returns Prisma rows or `null`. No HTTP exceptions, no permission checks
 *   — services do those.
 * - Houses queries that conditionally compose `where` based on workspace
 *   role, or that fan out to multiple includes. Trivial reads stay inline
 *   in the service.
 */
@Injectable()
export class ProjectsRepository {
  constructor(private prisma: PrismaService) {}

  /**
   * List projects in a workspace visible to a user. Workspace OWNER/ADMIN
   * see every project; regular members see only the ones they have a
   * project membership row for.
   *
   * `wsRole` is passed in so the caller can fetch it once and re-use it for
   * other access checks.
   */
  findAllByWorkspaceForUser(args: {
    workspaceId: string;
    userId: string;
    wsRole: WorkspaceRole;
  }) {
    const isWorkspaceAdmin =
      args.wsRole === WorkspaceRole.OWNER ||
      args.wsRole === WorkspaceRole.ADMIN;

    return this.prisma.project.findMany({
      where: {
        workspaceId: args.workspaceId,
        ...(isWorkspaceAdmin
          ? {}
          : { members: { some: { userId: args.userId } } }),
      },
      include: {
        lead: USER_SELECT_FULL,
        _count: { select: { members: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Project detail + members. Used by the project settings page and any
   * service that needs the full member list (project access checks, etc).
   */
  findByIdWithMembers(projectId: string) {
    return this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        lead: USER_SELECT_FULL,
        members: {
          include: { user: USER_SELECT_FULL },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });
  }
}
