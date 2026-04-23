import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { MSG, USER_SELECT_ADMIN } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { QueryUsersDto } from './dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

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
    await this.assertExists(id);
    const user = await this.prisma.user.update({
      where: { id },
      data: { role },
      ...USER_SELECT_ADMIN,
    });
    return { message: MSG.SUCCESS.USER_ROLE_UPDATED, user };
  }

  async remove(id: string, currentUserId: string) {
    if (id === currentUserId) {
      throw new ForbiddenException(MSG.ERROR.CANNOT_MODIFY_SELF);
    }
    await this.assertExists(id);
    await this.prisma.user.delete({ where: { id } });
    return { message: MSG.SUCCESS.USER_DELETED };
  }

  private async assertExists(id: string) {
    const exists = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException(MSG.ERROR.USER_NOT_FOUND);
  }
}
