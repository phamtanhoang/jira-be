import {
  BadRequestException,
  Inject,
  Injectable,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '@/core/database/prisma.service';
import { ProjectsService } from '@/modules/projects/projects.service';
import { IssuesService } from '../issues.service';

@Injectable()
export class IssuesBulkService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => IssuesService))
    private issuesService: IssuesService,
    private projectsService: ProjectsService,
  ) {}

  /**
   * Resolve every distinct project the supplied issues belong to and assert
   * the caller has access to all of them. The previous "validate the first
   * issue only" pattern let an attacker smuggle ids from projects they had
   * no access to into the array and silently mutate / delete them via
   * `updateMany` / `deleteMany`.
   */
  private async assertBulkAccess(
    userId: string,
    issueIds: string[],
  ): Promise<string[]> {
    if (!Array.isArray(issueIds) || issueIds.length === 0) {
      throw new BadRequestException('issueIds must not be empty');
    }
    const rows = await this.prisma.issue.findMany({
      where: { id: { in: issueIds } },
      select: { id: true, projectId: true },
    });
    if (rows.length !== new Set(issueIds).size) {
      // One or more ids point at a non-existent (or deleted) issue —
      // reject so the caller can recover rather than silently no-op.
      throw new BadRequestException('One or more issues were not found');
    }
    const projectIds = Array.from(new Set(rows.map((r) => r.projectId)));
    // Run access checks in parallel — typical bulk hits 1-3 projects.
    await Promise.all(
      projectIds.map((projectId) =>
        this.projectsService.assertProjectAccess(projectId, userId),
      ),
    );
    return rows.map((r) => r.id);
  }

  async bulkUpdate(
    userId: string,
    dto: {
      issueIds: string[];
      sprintId?: string | null;
      assigneeId?: string | null;
      priority?: string;
    },
  ) {
    // Resolve the issues + projectIds together so we can FK-scope the
    // sprint/assignee against the project each issue actually lives in.
    if (!Array.isArray(dto.issueIds) || dto.issueIds.length === 0) {
      throw new BadRequestException('issueIds must not be empty');
    }
    const rows = await this.prisma.issue.findMany({
      where: { id: { in: dto.issueIds } },
      select: { id: true, projectId: true },
    });
    if (rows.length !== new Set(dto.issueIds).size) {
      throw new BadRequestException('One or more issues were not found');
    }
    const projectIds = Array.from(new Set(rows.map((r) => r.projectId)));
    await Promise.all(
      projectIds.map((projectId) =>
        this.projectsService.assertProjectAccess(projectId, userId),
      ),
    );

    // If `sprintId` is set, it MUST belong to one of the projects we
    // just verified. Without this check the bulk path silently corrupts
    // cross-project sprint membership — single-issue update already
    // guards against the same class of bug.
    if (dto.sprintId) {
      const sprint = await this.prisma.sprint.findUnique({
        where: { id: dto.sprintId },
        select: { board: { select: { projectId: true } } },
      });
      if (!sprint || !projectIds.includes(sprint.board.projectId)) {
        throw new BadRequestException(
          'Sprint does not belong to issue project',
        );
      }
      // Additionally, every issue must share that sprint's project.
      const sprintProjectId = sprint.board.projectId;
      if (rows.some((r) => r.projectId !== sprintProjectId)) {
        throw new BadRequestException(
          'Cannot move issues from different projects into one sprint',
        );
      }
    }
    // If `assigneeId` is set, ensure they are a member of every workspace
    // the affected projects live under.
    if (dto.assigneeId) {
      const workspaceIds = await this.prisma.project
        .findMany({
          where: { id: { in: projectIds } },
          select: { workspaceId: true },
        })
        .then((ps) => Array.from(new Set(ps.map((p) => p.workspaceId))));
      const memberships = await this.prisma.workspaceMember.count({
        where: {
          userId: dto.assigneeId,
          workspaceId: { in: workspaceIds },
        },
      });
      if (memberships !== workspaceIds.length) {
        throw new BadRequestException(
          'Assignee is not a member of all workspaces',
        );
      }
    }

    const verifiedIds = rows.map((r) => r.id);

    const data: Record<string, unknown> = {};
    if (dto.sprintId !== undefined) data.sprintId = dto.sprintId;
    if (dto.assigneeId !== undefined) data.assigneeId = dto.assigneeId;
    if (dto.priority !== undefined) data.priority = dto.priority;

    const result = await this.prisma.issue.updateMany({
      where: { id: { in: verifiedIds } },
      data,
    });

    return { count: result.count };
  }

  async bulkDelete(userId: string, issueIds: string[]) {
    const verifiedIds = await this.assertBulkAccess(userId, issueIds);

    const result = await this.prisma.issue.deleteMany({
      where: { id: { in: verifiedIds } },
    });

    return { count: result.count };
  }
}
