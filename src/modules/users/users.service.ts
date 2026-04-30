import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { MSG, USER_SELECT_ADMIN } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { AdminAuditService } from '@/modules/admin-audit/admin-audit.service';
import { QueryUsersDto } from './dto';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private audit: AdminAuditService,
  ) {}

  async findAll(query: QueryUsersDto) {
    const take = query.take ?? 50;
    const where: Prisma.UserWhereInput = {};

    if (query.search) {
      where.OR = [
        {
          email: { contains: query.search, mode: Prisma.QueryMode.insensitive },
        },
        {
          name: { contains: query.search, mode: Prisma.QueryMode.insensitive },
        },
      ];
    }
    if (query.role) where.role = query.role;
    if (query.verified !== undefined) {
      where.emailVerified = query.verified ? { not: null } : null;
    }

    const data = await this.prisma.user.findMany({
      ...USER_SELECT_ADMIN,
      where,
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(query.cursor ? { skip: 1, cursor: { id: query.cursor } } : {}),
    });

    const hasMore = data.length > take;
    const rows = hasMore ? data.slice(0, take) : data;
    const nextCursor = hasMore ? rows[rows.length - 1].id : null;

    return { data: rows, nextCursor, hasMore };
  }

  async updateRole(id: string, role: Role, currentUserId: string) {
    if (id === currentUserId) {
      throw new ForbiddenException(MSG.ERROR.CANNOT_MODIFY_SELF);
    }
    const before = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, role: true },
    });
    if (!before) throw new NotFoundException(MSG.ERROR.USER_NOT_FOUND);

    const user = await this.prisma.user.update({
      where: { id },
      data: { role },
      ...USER_SELECT_ADMIN,
    });
    this.audit.log(currentUserId, 'ROLE_CHANGE', {
      target: id,
      targetType: 'User',
      payload: {
        from: before.role,
        to: role,
        targetName: before.name,
        targetEmail: before.email,
      },
    });
    return { message: MSG.SUCCESS.USER_ROLE_UPDATED, user };
  }

  async remove(id: string, currentUserId: string) {
    if (id === currentUserId) {
      throw new ForbiddenException(MSG.ERROR.CANNOT_MODIFY_SELF);
    }
    const before = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true },
    });
    if (!before) throw new NotFoundException(MSG.ERROR.USER_NOT_FOUND);

    await this.prisma.user.delete({ where: { id } });
    this.audit.log(currentUserId, 'USER_DELETE', {
      target: id,
      targetType: 'User',
      payload: { targetName: before.name, targetEmail: before.email },
    });
    return { message: MSG.SUCCESS.USER_DELETED };
  }

  /**
   * List active refresh-token sessions for a user. "Active" = not yet
   * expired. The `token` value itself is never returned — only metadata.
   */
  async listSessions(userId: string) {
    await this.assertExists(userId);
    const data = await this.prisma.refreshToken.findMany({
      where: { userId, expiresAt: { gt: new Date() } },
      select: { id: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return { data };
  }

  async revokeSession(userId: string, tokenId: string, actorId: string) {
    await this.assertExists(userId);
    const token = await this.prisma.refreshToken.findUnique({
      where: { id: tokenId },
      select: { id: true, userId: true },
    });
    if (!token || token.userId !== userId) {
      throw new NotFoundException(MSG.ERROR.REFRESH_TOKEN_NOT_FOUND);
    }
    await this.prisma.refreshToken.delete({ where: { id: tokenId } });
    this.audit.log(actorId, 'SESSION_REVOKE', {
      target: tokenId,
      targetType: 'RefreshToken',
      payload: { userId },
    });
    return { message: MSG.SUCCESS.SESSION_REVOKED };
  }

  async revokeAllSessions(userId: string, actorId: string) {
    await this.assertExists(userId);
    await this.prisma.refreshToken.deleteMany({ where: { userId } });
    this.audit.log(actorId, 'SESSIONS_REVOKE_ALL', {
      target: userId,
      targetType: 'User',
    });
    return { message: MSG.SUCCESS.SESSIONS_REVOKED };
  }

  /**
   * Activate or deactivate a user. Inactive users are rejected at login and
   * have their refresh tokens wiped so existing sessions die immediately.
   * Self-deactivation is forbidden so admins cannot lock themselves out.
   */
  async setActive(id: string, active: boolean, currentUserId: string) {
    if (id === currentUserId) {
      throw new ForbiddenException(MSG.ERROR.CANNOT_MODIFY_SELF);
    }
    await this.assertExists(id);
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        active,
        deactivatedAt: active ? null : new Date(),
      },
      ...USER_SELECT_ADMIN,
    });
    if (!active) {
      // Kill existing sessions so the user is logged out everywhere.
      await this.prisma.refreshToken.deleteMany({ where: { userId: id } });
    }
    this.audit.log(
      currentUserId,
      active ? 'USER_ACTIVATE' : 'USER_DEACTIVATE',
      { target: id, targetType: 'User' },
    );
    return {
      message: active
        ? MSG.SUCCESS.USER_ACTIVATED
        : MSG.SUCCESS.USER_DEACTIVATED,
      user,
    };
  }

  private async assertExists(id: string) {
    const exists = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException(MSG.ERROR.USER_NOT_FOUND);
  }

  /**
   * Public-ish profile for a user, viewable by anyone they share at least
   * one workspace with. Used by the @mention click-through and any future
   * "user card" UI. Strips fields that aren't safe to surface across the
   * tenancy boundary (role, deactivatedAt, deletionRequestedAt).
   *
   * Privacy gate: viewer + target must share a workspace. Otherwise 404
   * (not 403 — don't disclose existence to outsiders).
   */
  async getProfile(targetId: string, viewerId: string) {
    if (targetId === viewerId) {
      // Self-view is always allowed and skips the workspace probe.
      const self = await this.prisma.user.findUnique({
        where: { id: targetId },
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          createdAt: true,
        },
      });
      if (!self) throw new NotFoundException(MSG.ERROR.USER_NOT_FOUND);
      return { ...self, sharedWorkspacesCount: 0, isSelf: true };
    }

    // Privacy gate: viewer must be in at least one workspace where target is
    // also a member. We grab the count of overlapping workspaces in the same
    // round-trip — cheap, and the FE can show "X shared workspaces".
    const sharedWorkspacesCount = await this.prisma.workspace.count({
      where: {
        AND: [
          { members: { some: { userId: viewerId } } },
          { members: { some: { userId: targetId } } },
        ],
      },
    });

    if (sharedWorkspacesCount === 0) {
      // Don't leak existence to a stranger.
      throw new NotFoundException(MSG.ERROR.USER_NOT_FOUND);
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        createdAt: true,
      },
    });
    if (!target) throw new NotFoundException(MSG.ERROR.USER_NOT_FOUND);

    return { ...target, sharedWorkspacesCount, isSelf: false };
  }
}
