import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProjectRole } from '@prisma/client';
import { CacheTagsService } from '@/core/cache/cache-tags.service';
import { MSG, USER_SELECT_FULL } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import {
  InsufficientPermissionsException,
  ProjectAccessDeniedException,
  ProjectNotFoundException,
  QuotaExceededException,
} from '@/core/exceptions';
import { assertProjectAccess } from '@/core/utils';
import { AdminAuditService } from '@/modules/admin-audit/admin-audit.service';
import { BoardsService } from '@/modules/boards/boards.service';
import { SettingsService } from '@/modules/settings/settings.service';
import { WorkspacesService } from '@/modules/workspaces/workspaces.service';
import {
  AddProjectMemberDto,
  BulkAddProjectMembersDto,
  CreateProjectDto,
  UpdateProjectDto,
  UpdateProjectMemberDto,
} from './dto';
import { ProjectsRepository } from './projects.repository';

@Injectable()
export class ProjectsService {
  constructor(
    private prisma: PrismaService,
    private workspacesService: WorkspacesService,
    private boardsService: BoardsService,
    private audit: AdminAuditService,
    private settings: SettingsService,
    private projectsRepository: ProjectsRepository,
    private cacheTags: CacheTagsService,
  ) {}

  async create(userId: string, dto: CreateProjectDto) {
    await this.workspacesService.assertMember(dto.workspaceId, userId);

    // Tenant quota — projects per workspace.
    const quotas = await this.settings.getQuotas();
    if (quotas.maxProjectsPerWorkspace > 0) {
      const count = await this.prisma.project.count({
        where: { workspaceId: dto.workspaceId },
      });
      if (count >= quotas.maxProjectsPerWorkspace) {
        throw new QuotaExceededException(MSG.ERROR.QUOTA_PROJECTS_REACHED);
      }
    }

    const existing = await this.prisma.project.findUnique({
      where: {
        workspaceId_key: { workspaceId: dto.workspaceId, key: dto.key },
      },
    });
    if (existing) throw new BadRequestException(MSG.ERROR.PROJECT_KEY_EXISTS);

    const project = await this.prisma.project.create({
      data: {
        name: dto.name,
        key: dto.key,
        description: dto.description,
        workspaceId: dto.workspaceId,
        leadId: userId,
        type: dto.type,
        visibility: dto.visibility,
        members: {
          create: { userId, role: ProjectRole.LEAD },
        },
      },
      include: {
        lead: USER_SELECT_FULL,
        members: { include: { user: USER_SELECT_FULL } },
      },
    });

    // Auto-create default board with columns
    await this.boardsService.createDefaultBoard(
      project.id,
      project.name,
      project.type,
    );

    // Project list per user is cached by workspace tag.
    void this.cacheTags.invalidateTag(`workspace:${dto.workspaceId}`);
    return project;
  }

  async findAllByWorkspace(workspaceId: string, userId: string) {
    const wsMember = await this.workspacesService.assertMember(
      workspaceId,
      userId,
    );

    // Workspace OWNER/ADMIN see everything. Other roles (MEMBER/VIEWER) see only
    // projects they are a member of. Repository encapsulates the conditional
    // `where` clause.
    return this.cacheTags.wrap(
      `proj:list:ws:${workspaceId}:user:${userId}`,
      [`workspace:${workspaceId}`, `user:${userId}`],
      () =>
        this.projectsRepository.findAllByWorkspaceForUser({
          workspaceId,
          userId,
          wsRole: wsMember.role,
        }),
    );
  }

  async findById(projectId: string, userId: string) {
    const project =
      await this.projectsRepository.findByIdWithMembers(projectId);
    if (!project) throw new ProjectNotFoundException();

    await this.assertProjectAccess(project.id, userId, project.workspaceId);

    return project;
  }

  /**
   * Thin wrapper around the standalone `assertProjectAccess` util. Kept on
   * the service for modules that already depend on ProjectsService (issues)
   * so they don't need a separate import.
   */
  async assertProjectAccess(
    projectId: string,
    userId: string,
    workspaceId?: string,
  ) {
    let wsId = workspaceId;
    if (!wsId) {
      const p = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { workspaceId: true },
      });
      if (!p) throw new ProjectNotFoundException();
      wsId = p.workspaceId;
    }
    await assertProjectAccess(this.prisma, wsId, projectId, userId);
  }

  async update(projectId: string, userId: string, dto: UpdateProjectDto) {
    const project = await this.findById(projectId, userId);
    await this.assertRole(projectId, userId, [
      ProjectRole.LEAD,
      ProjectRole.ADMIN,
    ]);

    const updated = await this.prisma.project.update({
      where: { id: project.id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.coverUrl !== undefined && { coverUrl: dto.coverUrl }),
        ...(dto.visibility !== undefined && { visibility: dto.visibility }),
        ...(dto.defaultAssigneeId !== undefined && {
          defaultAssigneeId: dto.defaultAssigneeId,
        }),
      },
    });
    void this.cacheTags.invalidateTag(`workspace:${project.workspaceId}`);
    return updated;
  }

  async delete(projectId: string, userId: string) {
    const project = await this.findById(projectId, userId);
    await this.assertRole(projectId, userId, [ProjectRole.LEAD]);

    const deleted = await this.prisma.project.delete({
      where: { id: project.id },
    });
    this.audit.log(userId, 'PROJECT_DELETE', {
      target: project.id,
      targetType: 'Project',
      payload: {
        targetName: project.name,
        targetKey: project.key,
        workspaceId: project.workspaceId,
      },
    });
    void this.cacheTags.invalidateTag(`workspace:${project.workspaceId}`);
    return deleted;
  }

  // ─── Members ──────────────────────────────────────────

  async addMember(projectId: string, userId: string, dto: AddProjectMemberDto) {
    const project = await this.findById(projectId, userId);
    await this.assertRole(projectId, userId, [
      ProjectRole.LEAD,
      ProjectRole.ADMIN,
    ]);

    const targetUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!targetUser) throw new NotFoundException(MSG.ERROR.USER_NOT_FOUND);

    // Target user must be a workspace member
    await this.workspacesService.assertMember(
      project.workspaceId,
      targetUser.id,
    );

    const existing = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: targetUser.id } },
    });
    if (existing)
      throw new BadRequestException(MSG.ERROR.ALREADY_PROJECT_MEMBER);

    const created = await this.prisma.projectMember.create({
      data: {
        projectId,
        userId: targetUser.id,
        role: dto.role ?? ProjectRole.DEVELOPER,
      },
      include: { user: USER_SELECT_FULL },
    });
    // Project list visibility depends on membership for non-admin users.
    void this.cacheTags.invalidateTag(`workspace:${project.workspaceId}`);
    return created;
  }

  /**
   * Add multiple workspace members to a project in one shot. Skips users who
   * are not workspace members (security boundary) and users already on the
   * project (idempotent). Returns the freshly-created member rows.
   */
  async bulkAddMembers(
    projectId: string,
    userId: string,
    dto: BulkAddProjectMembersDto,
  ) {
    const project = await this.findById(projectId, userId);
    await this.assertRole(projectId, userId, [
      ProjectRole.LEAD,
      ProjectRole.ADMIN,
    ]);

    const [wsMembers, existing] = await Promise.all([
      this.prisma.workspaceMember.findMany({
        where: {
          workspaceId: project.workspaceId,
          userId: { in: dto.userIds },
        },
        select: { userId: true },
      }),
      this.prisma.projectMember.findMany({
        where: { projectId, userId: { in: dto.userIds } },
        select: { userId: true },
      }),
    ]);

    const wsMemberIds = new Set(wsMembers.map((m) => m.userId));
    const alreadyOnProject = new Set(existing.map((m) => m.userId));

    const toAdd = dto.userIds.filter(
      (id) => wsMemberIds.has(id) && !alreadyOnProject.has(id),
    );

    if (toAdd.length === 0) {
      return { added: 0, skipped: dto.userIds.length };
    }

    await this.prisma.projectMember.createMany({
      data: toAdd.map((uid) => ({
        projectId,
        userId: uid,
        role: dto.role ?? ProjectRole.DEVELOPER,
      })),
    });

    const added = await this.prisma.projectMember.findMany({
      where: { projectId, userId: { in: toAdd } },
      include: { user: USER_SELECT_FULL },
    });

    if (added.length > 0) {
      void this.cacheTags.invalidateTag(`workspace:${project.workspaceId}`);
    }

    return {
      added: added.length,
      skipped: dto.userIds.length - added.length,
      members: added,
    };
  }

  async listMembers(projectId: string, userId: string) {
    await this.assertProjectAccess(projectId, userId);
    return this.prisma.projectMember.findMany({
      where: { projectId },
      include: { user: USER_SELECT_FULL },
      orderBy: { joinedAt: 'asc' },
    });
  }

  async updateMemberRole(
    projectId: string,
    memberId: string,
    userId: string,
    dto: UpdateProjectMemberDto,
  ) {
    await this.assertRole(projectId, userId, [
      ProjectRole.LEAD,
      ProjectRole.ADMIN,
    ]);

    const member = await this.prisma.projectMember.findUnique({
      where: { id: memberId },
    });
    if (!member || member.projectId !== projectId) {
      throw new NotFoundException(MSG.ERROR.NOT_PROJECT_MEMBER);
    }
    if (member.role === ProjectRole.LEAD) {
      throw new ForbiddenException(MSG.ERROR.CANNOT_REMOVE_OWNER);
    }

    return this.prisma.projectMember.update({
      where: { id: memberId },
      data: { role: dto.role },
      include: { user: USER_SELECT_FULL },
    });
  }

  async removeMember(projectId: string, memberId: string, userId: string) {
    await this.assertRole(projectId, userId, [
      ProjectRole.LEAD,
      ProjectRole.ADMIN,
    ]);

    const member = await this.prisma.projectMember.findUnique({
      where: { id: memberId },
    });
    if (!member || member.projectId !== projectId) {
      throw new NotFoundException(MSG.ERROR.NOT_PROJECT_MEMBER);
    }
    if (member.role === ProjectRole.LEAD) {
      throw new ForbiddenException(MSG.ERROR.CANNOT_REMOVE_OWNER);
    }

    return this.prisma.projectMember.delete({ where: { id: memberId } });
  }

  // ─── Helpers ──────────────────────────────────────────

  // Public so other modules (saved-filters, issue-templates, ...) can gate
  // their write operations on the same role hierarchy without re-implementing
  // the lookup.
  async assertRole(projectId: string, userId: string, roles: ProjectRole[]) {
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!member) throw new ProjectAccessDeniedException();
    if (!roles.includes(member.role)) {
      throw new InsufficientPermissionsException();
    }
    return member;
  }
}
