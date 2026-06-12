import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WorkspaceRole } from '@prisma/client';
import { CacheTagsService } from '@/core/cache/cache-tags.service';
import { MSG } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import {
  InsufficientPermissionsException,
  WorkspaceAccessDeniedException,
} from '@/core/exceptions';
import {
  MAX_SLUG_RETRY,
  candidateSlug,
  generateSlug,
  isUniqueConstraintError,
} from '@/core/utils';
import { AdminAuditService } from '@/modules/admin-audit/admin-audit.service';
import { SettingsService } from '@/modules/settings/settings.service';
import {
  AddWorkspaceMemberDto,
  CreateWorkspaceDto,
  TransferWorkspaceOwnerDto,
  UpdateWorkspaceDto,
  UpdateWorkspaceMemberDto,
} from './dto';

@Injectable()
export class WorkspacesService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private cacheTags: CacheTagsService,
    private audit: AdminAuditService,
  ) {}

  async create(userId: string, dto: CreateWorkspaceDto) {
    // Slug is unique per owner — two unrelated users can each have a
    // "marketing" workspace. Only the SAME owner creating "Marketing"
    // twice triggers auto-suffix ("marketing", "marketing-2"). The retry
    // loop also closes the TOCTOU race for the same user firing duplicate
    // creates from two tabs.
    const base = generateSlug(dto.name);
    const created = await this.createWithUniqueSlug(base, (slug) =>
      this.prisma.workspace.create({
        data: {
          name: dto.name,
          slug,
          description: dto.description,
          ownerId: userId,
          members: {
            create: { userId, role: WorkspaceRole.OWNER },
          },
        },
        include: {
          members: {
            include: {
              user: {
                select: { id: true, name: true, email: true, image: true },
              },
            },
          },
        },
      }),
    );

    void this.cacheTags.invalidateTag(`user:${userId}`);
    return created;
  }

  /**
   * Retry the supplied create/update with progressively-suffixed slugs
   * until the (ownerId, slug) composite unique succeeds. Final attempt
   * uses a short random suffix so the loop is bounded in O(1) under
   * heavy contention.
   */
  private async createWithUniqueSlug<T>(
    baseSlug: string,
    create: (slug: string) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt <= MAX_SLUG_RETRY; attempt++) {
      const slug = candidateSlug(baseSlug, attempt);
      try {
        return await create(slug);
      } catch (err) {
        if (isUniqueConstraintError(err, 'slug')) continue;
        throw err;
      }
    }
    // Unreachable in practice — the final attempt uses a random suffix.
    throw new BadRequestException(MSG.ERROR.WORKSPACE_SLUG_EXISTS);
  }

  async findAllByUser(userId: string) {
    return this.cacheTags.wrap(
      `ws:list:user:${userId}`,
      [`user:${userId}`, 'workspaces'],
      () =>
        this.prisma.workspace.findMany({
          where: { members: { some: { userId } } },
          include: {
            _count: { select: { members: true, projects: true } },
            owner: {
              select: { id: true, name: true, email: true, image: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
    );
  }

  async findById(workspaceId: string, userId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, name: true, email: true, image: true },
            },
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
    await this.assertRole(workspaceId, userId, [
      WorkspaceRole.OWNER,
      WorkspaceRole.ADMIN,
    ]);

    const data: Prisma.WorkspaceUpdateInput = {};
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.logoUrl !== undefined) data.logoUrl = dto.logoUrl;

    if (dto.name !== undefined) {
      data.name = dto.name;
      const base = generateSlug(dto.name);
      // Re-use the retry loop so renaming to a popular name auto-suffixes
      // instead of hard-failing — same UX as create.
      const updated = await this.createWithUniqueSlug(base, (slug) =>
        this.prisma.workspace.update({
          where: { id: workspaceId },
          data: { ...data, slug },
        }),
      );
      void this.cacheTags.invalidateTag(`workspace:${workspaceId}`);
      return updated;
    }

    const updated = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data,
    });
    void this.cacheTags.invalidateTag(`workspace:${workspaceId}`);
    return updated;
  }

  async delete(workspaceId: string, userId: string) {
    await this.assertRole(workspaceId, userId, [WorkspaceRole.OWNER]);

    const deleted = await this.prisma.workspace.delete({
      where: { id: workspaceId },
    });
    void this.cacheTags.invalidateTags([
      `workspace:${workspaceId}`,
      'workspaces',
    ]);
    return deleted;
  }

  /**
   * Transfer OWNER role to another member of the workspace. Swaps the old
   * and new owner's `role` columns + flips `Workspace.ownerId` atomically
   * so the workspace never has zero owners or two owners.
   *
   * The previous owner is demoted to ADMIN — preserves their power without
   * surprising them with "you've been kicked out" UX.
   */
  async transferOwnership(
    workspaceId: string,
    currentUserId: string,
    dto: TransferWorkspaceOwnerDto,
  ) {
    await this.assertRole(workspaceId, currentUserId, [WorkspaceRole.OWNER]);

    if (dto.newOwnerId === currentUserId) {
      throw new BadRequestException(MSG.ERROR.CANNOT_TRANSFER_TO_SELF);
    }

    const newOwner = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId, userId: dto.newOwnerId },
      },
      include: {
        user: { select: { id: true, name: true, email: true, image: true } },
      },
    });
    if (!newOwner) {
      throw new BadRequestException(MSG.ERROR.NEW_OWNER_NOT_MEMBER);
    }

    // Atomic flip: old → ADMIN, new → OWNER, workspace.ownerId → new.
    // All three writes commit together so the workspace never observes
    // zero OWNERs (which would lock everyone out of OWNER-only actions).
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.workspaceMember.update({
        where: {
          workspaceId_userId: { workspaceId, userId: currentUserId },
        },
        data: { role: WorkspaceRole.ADMIN },
      });
      await tx.workspaceMember.update({
        where: {
          workspaceId_userId: { workspaceId, userId: dto.newOwnerId },
        },
        data: { role: WorkspaceRole.OWNER },
      });
      return tx.workspace.update({
        where: { id: workspaceId },
        data: { ownerId: dto.newOwnerId },
        include: {
          owner: {
            select: { id: true, name: true, email: true, image: true },
          },
        },
      });
    });

    this.audit.log(currentUserId, 'WORKSPACE_OWNER_TRANSFER', {
      target: workspaceId,
      targetType: 'Workspace',
      payload: {
        workspaceId,
        targetName: updated.name,
        from: currentUserId,
        to: dto.newOwnerId,
        newOwnerName: newOwner.user.name,
        newOwnerEmail: newOwner.user.email,
      },
    });

    void this.cacheTags.invalidateTags([
      `workspace:${workspaceId}`,
      `user:${currentUserId}`,
      `user:${dto.newOwnerId}`,
    ]);
    return updated;
  }

  // ─── Members ──────────────────────────────────────────

  async addMember(
    workspaceId: string,
    userId: string,
    dto: AddWorkspaceMemberDto,
  ) {
    await this.assertRole(workspaceId, userId, [
      WorkspaceRole.OWNER,
      WorkspaceRole.ADMIN,
    ]);

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) throw new NotFoundException(MSG.ERROR.USER_NOT_FOUND);

    const existing = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: user.id } },
    });
    if (existing)
      throw new BadRequestException(MSG.ERROR.ALREADY_WORKSPACE_MEMBER);

    // Tenant quota — members per workspace.
    const quotas = await this.settings.getQuotas();
    if (quotas.maxMembersPerWorkspace > 0) {
      const count = await this.prisma.workspaceMember.count({
        where: { workspaceId },
      });
      if (count >= quotas.maxMembersPerWorkspace) {
        throw new ForbiddenException(MSG.ERROR.QUOTA_MEMBERS_REACHED);
      }
    }

    const created = await this.prisma.workspaceMember.create({
      data: {
        workspaceId,
        userId: user.id,
        role: dto.role ?? WorkspaceRole.MEMBER,
      },
      include: {
        user: { select: { id: true, name: true, email: true, image: true } },
      },
    });

    this.audit.log(userId, 'WORKSPACE_MEMBER_ADD', {
      target: created.id,
      targetType: 'WorkspaceMember',
      payload: {
        workspaceId,
        targetUserId: user.id,
        targetName: user.name,
        targetEmail: user.email,
        role: created.role,
      },
    });

    // The new member's workspace list now includes this workspace.
    void this.cacheTags.invalidateTag(`user:${user.id}`);
    return created;
  }

  async updateMember(
    workspaceId: string,
    memberId: string,
    userId: string,
    dto: UpdateWorkspaceMemberDto,
  ) {
    await this.assertRole(workspaceId, userId, [
      WorkspaceRole.OWNER,
      WorkspaceRole.ADMIN,
    ]);

    const member = await this.prisma.workspaceMember.findUnique({
      where: { id: memberId },
      include: {
        user: { select: { id: true, name: true, email: true, image: true } },
      },
    });
    if (!member || member.workspaceId !== workspaceId) {
      throw new NotFoundException(MSG.ERROR.NOT_WORKSPACE_MEMBER);
    }
    if (member.role === WorkspaceRole.OWNER) {
      throw new ForbiddenException(MSG.ERROR.CANNOT_REMOVE_OWNER);
    }

    const previousRole = member.role;
    const updated = await this.prisma.workspaceMember.update({
      where: { id: memberId },
      data: { role: dto.role },
      include: {
        user: { select: { id: true, name: true, email: true, image: true } },
      },
    });

    if (previousRole !== updated.role) {
      this.audit.log(userId, 'WORKSPACE_MEMBER_ROLE_UPDATE', {
        target: memberId,
        targetType: 'WorkspaceMember',
        payload: {
          workspaceId,
          targetUserId: member.userId,
          targetName: member.user.name,
          targetEmail: member.user.email,
          from: previousRole,
          to: updated.role,
        },
      });
    }

    return updated;
  }

  async removeMember(workspaceId: string, memberId: string, userId: string) {
    await this.assertRole(workspaceId, userId, [
      WorkspaceRole.OWNER,
      WorkspaceRole.ADMIN,
    ]);

    const member = await this.prisma.workspaceMember.findUnique({
      where: { id: memberId },
      include: {
        user: { select: { id: true, name: true, email: true, image: true } },
      },
    });
    if (!member || member.workspaceId !== workspaceId) {
      throw new NotFoundException(MSG.ERROR.NOT_WORKSPACE_MEMBER);
    }
    if (member.role === WorkspaceRole.OWNER) {
      throw new ForbiddenException(MSG.ERROR.CANNOT_REMOVE_OWNER);
    }

    const removed = await this.prisma.workspaceMember.delete({
      where: { id: memberId },
    });

    this.audit.log(userId, 'WORKSPACE_MEMBER_REMOVE', {
      target: memberId,
      targetType: 'WorkspaceMember',
      payload: {
        workspaceId,
        targetUserId: member.userId,
        targetName: member.user.name,
        targetEmail: member.user.email,
        role: member.role,
      },
    });

    void this.cacheTags.invalidateTag(`user:${member.userId}`);
    return removed;
  }

  // ─── Helpers ──────────────────────────────────────────

  async assertMember(workspaceId: string, userId: string) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!member) throw new WorkspaceAccessDeniedException();
    return member;
  }

  // Public so other modules (invite-links, ...) can gate writes on the
  // same workspace-role hierarchy without re-implementing the lookup.
  async assertRole(
    workspaceId: string,
    userId: string,
    roles: WorkspaceRole[],
  ) {
    const member = await this.assertMember(workspaceId, userId);
    if (!roles.includes(member.role)) {
      throw new InsufficientPermissionsException();
    }
    return member;
  }
}
