import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MSG, USER_SELECT_BASIC } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { ProjectsService } from '@/modules/projects/projects.service';
import { CreateSavedFilterDto, UpdateSavedFilterDto } from './dto';

@Injectable()
export class SavedFiltersService {
  constructor(
    private prisma: PrismaService,
    private projectsService: ProjectsService,
  ) {}

  /**
   * Returns the user's own filters + project-shared filters from other
   * members. Sorted with personal first so "My filters" appears at the top.
   */
  async findAll(projectId: string, userId: string) {
    await this.projectsService.assertProjectAccess(projectId, userId);
    return this.prisma.savedFilter.findMany({
      where: {
        projectId,
        OR: [{ ownerId: userId }, { shared: true }],
      },
      include: { owner: USER_SELECT_BASIC },
      orderBy: [
        { ownerId: userId === '__placeholder__' ? 'asc' : 'desc' },
        { name: 'asc' },
      ],
    });
  }

  async create(userId: string, dto: CreateSavedFilterDto) {
    await this.projectsService.assertProjectAccess(dto.projectId, userId);
    try {
      return await this.prisma.savedFilter.create({
        data: {
          projectId: dto.projectId,
          ownerId: userId,
          name: dto.name.trim(),
          payload: dto.payload as Prisma.InputJsonValue,
          shared: dto.shared ?? false,
        },
        include: { owner: USER_SELECT_BASIC },
      });
    } catch (err) {
      // Same name within a single owner+project pair feels redundant — not
      // a hard DB constraint, but we surface a friendly error if it ever
      // becomes one in the future.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(MSG.ERROR.SAVED_FILTER_NAME_EXISTS);
      }
      throw err;
    }
  }

  async update(id: string, userId: string, dto: UpdateSavedFilterDto) {
    const filter = await this.prisma.savedFilter.findUnique({ where: { id } });
    if (!filter) throw new NotFoundException(MSG.ERROR.SAVED_FILTER_NOT_FOUND);
    if (filter.ownerId !== userId) {
      // Only the owner can edit their filter — even an admin shouldn't
      // mutate someone else's saved view.
      throw new ForbiddenException(MSG.ERROR.NOT_AUTHOR);
    }
    return this.prisma.savedFilter.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.payload !== undefined && {
          payload: dto.payload as Prisma.InputJsonValue,
        }),
        ...(dto.shared !== undefined && { shared: dto.shared }),
      },
      include: { owner: USER_SELECT_BASIC },
    });
  }

  async delete(id: string, userId: string) {
    const filter = await this.prisma.savedFilter.findUnique({ where: { id } });
    if (!filter) throw new NotFoundException(MSG.ERROR.SAVED_FILTER_NOT_FOUND);
    if (filter.ownerId !== userId) {
      throw new ForbiddenException(MSG.ERROR.NOT_AUTHOR);
    }
    await this.prisma.savedFilter.delete({ where: { id } });
  }
}
