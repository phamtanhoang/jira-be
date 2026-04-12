import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { MSG } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import {
  AddWorkspaceMemberDto,
  CreateWorkspaceDto,
  UpdateWorkspaceDto,
  UpdateWorkspaceMemberDto,
} from './dto';

@Injectable()
export class WorkspacesService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateWorkspaceDto) {
    const slug = this.generateSlug(dto.name);

    const existing = await this.prisma.workspace.findUnique({
      where: { slug },
    });
    if (existing) throw new BadRequestException(MSG.ERROR.WORKSPACE_SLUG_EXISTS);

    return this.prisma.workspace.create({
      data: {
        name: dto.name,
        slug,
        description: dto.description,
        ownerId: userId,
        members: {
          create: { userId, role: WorkspaceRole.OWNER },
        },
      },
      include: { members: { include: { user: { select: { id: true, name: true, email: true, image: true } } } } },
    });
  }

  async findAllByUser(userId: string) {
    return this.prisma.workspace.findMany({
      where: { members: { some: { userId } } },
      include: {
        _count: { select: { members: true, projects: true } },
        owner: { select: { id: true, name: true, email: true, image: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(workspaceId: string, userId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        members: {
          include: {
            user: { select: { id: true, name: true, email: true, image: true } },
          },
          orderBy: { joinedAt: 'asc' },
        },
        _count: { select: { projects: true } },
      },
    });
    if (!workspace) throw new NotFoundException(MSG.ERROR.WORKSPACE_NOT_FOUND);

    await this.assertMember(workspaceId, userId);

    return workspace;
  }

  async update(workspaceId: string, userId: string, dto: UpdateWorkspaceDto) {
    await this.assertRole(workspaceId, userId, [WorkspaceRole.OWNER, WorkspaceRole.ADMIN]);

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      data.name = dto.name;
      data.slug = this.generateSlug(dto.name);

      const existing = await this.prisma.workspace.findUnique({
        where: { slug: data.slug as string },
      });
      if (existing && existing.id !== workspaceId) {
        throw new BadRequestException(MSG.ERROR.WORKSPACE_SLUG_EXISTS);
      }
    }
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.logoUrl !== undefined) data.logoUrl = dto.logoUrl;

    return this.prisma.workspace.update({
      where: { id: workspaceId },
      data,
    });
  }

  async delete(workspaceId: string, userId: string) {
    await this.assertRole(workspaceId, userId, [WorkspaceRole.OWNER]);

    return this.prisma.workspace.delete({ where: { id: workspaceId } });
  }

  // ─── Members ──────────────────────────────────────────

  async addMember(workspaceId: string, userId: string, dto: AddWorkspaceMemberDto) {
    await this.assertRole(workspaceId, userId, [WorkspaceRole.OWNER, WorkspaceRole.ADMIN]);

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) throw new NotFoundException(MSG.ERROR.USER_NOT_FOUND);

    const existing = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: user.id } },
    });
    if (existing) throw new BadRequestException(MSG.ERROR.ALREADY_WORKSPACE_MEMBER);

    return this.prisma.workspaceMember.create({
      data: {
        workspaceId,
        userId: user.id,
        role: dto.role ?? WorkspaceRole.MEMBER,
      },
      include: {
        user: { select: { id: true, name: true, email: true, image: true } },
      },
    });
  }

  async updateMember(
    workspaceId: string,
    memberId: string,
    userId: string,
    dto: UpdateWorkspaceMemberDto,
  ) {
    await this.assertRole(workspaceId, userId, [WorkspaceRole.OWNER, WorkspaceRole.ADMIN]);

    const member = await this.prisma.workspaceMember.findUnique({
      where: { id: memberId },
    });
    if (!member || member.workspaceId !== workspaceId) {
      throw new NotFoundException(MSG.ERROR.NOT_WORKSPACE_MEMBER);
    }
    if (member.role === WorkspaceRole.OWNER) {
      throw new ForbiddenException(MSG.ERROR.CANNOT_REMOVE_OWNER);
    }

    return this.prisma.workspaceMember.update({
      where: { id: memberId },
      data: { role: dto.role },
      include: {
        user: { select: { id: true, name: true, email: true, image: true } },
      },
    });
  }

  async removeMember(workspaceId: string, memberId: string, userId: string) {
    await this.assertRole(workspaceId, userId, [WorkspaceRole.OWNER, WorkspaceRole.ADMIN]);

    const member = await this.prisma.workspaceMember.findUnique({
      where: { id: memberId },
    });
    if (!member || member.workspaceId !== workspaceId) {
      throw new NotFoundException(MSG.ERROR.NOT_WORKSPACE_MEMBER);
    }
    if (member.role === WorkspaceRole.OWNER) {
      throw new ForbiddenException(MSG.ERROR.CANNOT_REMOVE_OWNER);
    }

    return this.prisma.workspaceMember.delete({ where: { id: memberId } });
  }

  // ─── Helpers ──────────────────────────────────────────

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  async assertMember(workspaceId: string, userId: string) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!member) throw new ForbiddenException(MSG.ERROR.NOT_WORKSPACE_MEMBER);
    return member;
  }

  private async assertRole(workspaceId: string, userId: string, roles: WorkspaceRole[]) {
    const member = await this.assertMember(workspaceId, userId);
    if (!roles.includes(member.role)) {
      throw new ForbiddenException(MSG.ERROR.INSUFFICIENT_PERMISSIONS);
    }
    return member;
  }
}
