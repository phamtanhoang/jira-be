import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProjectRole } from '@prisma/client';
import { MSG, USER_SELECT_FULL } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { WorkspacesService } from '@/modules/workspaces/workspaces.service';
import { BoardsService } from '@/modules/boards/boards.service';
import { AddProjectMemberDto, CreateProjectDto, UpdateProjectDto } from './dto';

@Injectable()
export class ProjectsService {
  constructor(
    private prisma: PrismaService,
    private workspacesService: WorkspacesService,
    private boardsService: BoardsService,
  ) {}

  async create(userId: string, dto: CreateProjectDto) {
    await this.workspacesService.assertMember(dto.workspaceId, userId);

    const existing = await this.prisma.project.findUnique({
      where: { workspaceId_key: { workspaceId: dto.workspaceId, key: dto.key } },
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
    await this.boardsService.createDefaultBoard(project.id, project.name, project.type);

    return project;
  }

  async findAllByWorkspace(workspaceId: string, userId: string) {
    await this.workspacesService.assertMember(workspaceId, userId);

    return this.prisma.project.findMany({
      where: { workspaceId },
      include: {
        lead: USER_SELECT_FULL,
        _count: { select: { members: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(projectId: string, userId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        lead: USER_SELECT_FULL,
        members: {
          include: { user: USER_SELECT_FULL },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });
    if (!project) throw new NotFoundException(MSG.ERROR.PROJECT_NOT_FOUND);

    await this.workspacesService.assertMember(project.workspaceId, userId);

    return project;
  }

  async update(projectId: string, userId: string, dto: UpdateProjectDto) {
    const project = await this.findById(projectId, userId);
    await this.assertRole(projectId, userId, [ProjectRole.LEAD, ProjectRole.ADMIN]);

    return this.prisma.project.update({
      where: { id: project.id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.coverUrl !== undefined && { coverUrl: dto.coverUrl }),
        ...(dto.visibility !== undefined && { visibility: dto.visibility }),
        ...(dto.defaultAssigneeId !== undefined && { defaultAssigneeId: dto.defaultAssigneeId }),
      },
    });
  }

  async delete(projectId: string, userId: string) {
    const project = await this.findById(projectId, userId);
    await this.assertRole(projectId, userId, [ProjectRole.LEAD]);

    return this.prisma.project.delete({ where: { id: project.id } });
  }

  // ─── Members ──────────────────────────────────────────

  async addMember(projectId: string, userId: string, dto: AddProjectMemberDto) {
    const project = await this.findById(projectId, userId);
    await this.assertRole(projectId, userId, [ProjectRole.LEAD, ProjectRole.ADMIN]);

    const targetUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!targetUser) throw new NotFoundException(MSG.ERROR.USER_NOT_FOUND);

    // Target user must be a workspace member
    await this.workspacesService.assertMember(project.workspaceId, targetUser.id);

    const existing = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: targetUser.id } },
    });
    if (existing) throw new BadRequestException(MSG.ERROR.ALREADY_PROJECT_MEMBER);

    return this.prisma.projectMember.create({
      data: {
        projectId,
        userId: targetUser.id,
        role: dto.role ?? ProjectRole.DEVELOPER,
      },
      include: { user: USER_SELECT_FULL },
    });
  }

  async removeMember(projectId: string, memberId: string, userId: string) {
    await this.assertRole(projectId, userId, [ProjectRole.LEAD, ProjectRole.ADMIN]);

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

  private async assertRole(projectId: string, userId: string, roles: ProjectRole[]) {
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!member) throw new ForbiddenException(MSG.ERROR.NOT_PROJECT_MEMBER);
    if (!roles.includes(member.role)) {
      throw new ForbiddenException(MSG.ERROR.INSUFFICIENT_PERMISSIONS);
    }
    return member;
  }
}
