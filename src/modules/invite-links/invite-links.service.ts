import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { MSG, USER_SELECT_BASIC } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { generateShareToken } from '@/core/utils';
import { WorkspacesService } from '@/modules/workspaces/workspaces.service';
import type { CreateInviteLinkDto } from './dto';

const MANAGE_ROLES: WorkspaceRole[] = [
  WorkspaceRole.OWNER,
  WorkspaceRole.ADMIN,
];

@Injectable()
export class InviteLinksService {
  constructor(
    private prisma: PrismaService,
    private workspacesService: WorkspacesService,
  ) {}

  async list(workspaceId: string, userId: string) {
    await this.workspacesService.assertRole(workspaceId, userId, MANAGE_ROLES);
    return this.prisma.workspaceInviteLink.findMany({
      where: { workspaceId },
      include: { createdBy: USER_SELECT_BASIC },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(workspaceId: string, userId: string, dto: CreateInviteLinkDto) {
    await this.workspacesService.assertRole(workspaceId, userId, MANAGE_ROLES);
    const role = dto.role ?? WorkspaceRole.MEMBER;
    // OWNER role is reserved for transfer flows — never grantable via a
    // shareable link, even if an admin asks for it.
    if (role === WorkspaceRole.OWNER) {
      throw new BadRequestException(MSG.ERROR.INSUFFICIENT_PERMISSIONS);
    }
    const expiresAt =
      dto.expiresInSec && dto.expiresInSec > 0
        ? new Date(Date.now() + dto.expiresInSec * 1000)
        : null;
    return this.prisma.workspaceInviteLink.create({
      data: {
        workspaceId,
        token: generateShareToken(),
        role,
        maxUses: dto.maxUses ?? null,
        expiresAt,
        createdById: userId,
      },
    });
  }

  async revoke(workspaceId: string, linkId: string, userId: string) {
    await this.workspacesService.assertRole(workspaceId, userId, MANAGE_ROLES);
    const link = await this.prisma.workspaceInviteLink.findUnique({
      where: { id: linkId },
    });
    if (!link || link.workspaceId !== workspaceId) {
      throw new NotFoundException(MSG.ERROR.INVITE_LINK_NOT_FOUND);
    }
    await this.prisma.workspaceInviteLink.delete({ where: { id: linkId } });
  }

  /**
   * Read-only preview shown on the join page so the invitee sees the
   * workspace name + role they'd get BEFORE clicking Accept. Validates the
   * token but doesn't side-effect the counter.
   */
  async preview(token: string) {
    const link = await this.findValidLink(token);
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: link.workspaceId },
      select: { id: true, name: true, slug: true, description: true },
    });
    if (!workspace) {
      throw new NotFoundException(MSG.ERROR.WORKSPACE_NOT_FOUND);
    }
    return {
      workspace,
      role: link.role,
      expiresAt: link.expiresAt,
      remainingUses:
        link.maxUses != null ? link.maxUses - link.usedCount : null,
    };
  }

  /**
   * Add the calling user to the workspace at the link's role. Idempotent —
   * if the user is already a member, returns success without bumping the
   * counter (otherwise reload would burn invites).
   */
  async join(token: string, userId: string) {
    const link = await this.findValidLink(token);

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: { workspaceId: link.workspaceId, userId },
        },
      });
      if (existing) {
        // Already a member — return the workspace info so the FE can
        // navigate, but don't burn an invite slot.
        const workspace = await tx.workspace.findUnique({
          where: { id: link.workspaceId },
          select: { id: true, name: true, slug: true },
        });
        return { workspace, alreadyMember: true };
      }

      await tx.workspaceMember.create({
        data: { workspaceId: link.workspaceId, userId, role: link.role },
      });
      // Re-check exhaustion under the transaction so two concurrent joins
      // can't both squeeze through when only 1 slot remained.
      const updated = await tx.workspaceInviteLink.update({
        where: { id: link.id },
        data: { usedCount: { increment: 1 } },
      });
      if (updated.maxUses != null && updated.usedCount > updated.maxUses) {
        throw new BadRequestException(MSG.ERROR.INVITE_LINK_EXHAUSTED);
      }
      const workspace = await tx.workspace.findUnique({
        where: { id: link.workspaceId },
        select: { id: true, name: true, slug: true },
      });
      return { workspace, alreadyMember: false };
    });
  }

  private async findValidLink(token: string) {
    const link = await this.prisma.workspaceInviteLink.findUnique({
      where: { token },
    });
    if (!link) throw new NotFoundException(MSG.ERROR.INVITE_LINK_NOT_FOUND);
    if (link.expiresAt && link.expiresAt < new Date()) {
      throw new ForbiddenException(MSG.ERROR.INVITE_LINK_EXPIRED);
    }
    if (link.maxUses != null && link.usedCount >= link.maxUses) {
      throw new ForbiddenException(MSG.ERROR.INVITE_LINK_EXHAUSTED);
    }
    return link;
  }
}
