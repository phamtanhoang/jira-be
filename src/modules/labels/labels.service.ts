import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MSG } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { ProjectNotFoundException } from '@/core/exceptions';
import { assertProjectAccess } from '@/core/utils';
import { CreateLabelDto, UpdateLabelDto } from './dto';

@Injectable()
export class LabelsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateLabelDto) {
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
    });
    if (!project) throw new ProjectNotFoundException();

    await assertProjectAccess(
      this.prisma,
      project.workspaceId,
      project.id,
      userId,
    );

    const existing = await this.prisma.label.findUnique({
      where: { projectId_name: { projectId: dto.projectId, name: dto.name } },
    });
    if (existing) throw new BadRequestException(MSG.ERROR.LABEL_ALREADY_EXISTS);

    return this.prisma.label.create({
      data: { projectId: dto.projectId, name: dto.name, color: dto.color },
    });
  }

  async findAllByProject(projectId: string, userId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new ProjectNotFoundException();

    await assertProjectAccess(
      this.prisma,
      project.workspaceId,
      project.id,
      userId,
    );

    return this.prisma.label.findMany({
      where: { projectId },
      include: { _count: { select: { issues: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async update(labelId: string, userId: string, dto: UpdateLabelDto) {
    const label = await this.prisma.label.findUnique({
      where: { id: labelId },
      include: { project: { select: { id: true, workspaceId: true } } },
    });
    if (!label) throw new NotFoundException(MSG.ERROR.LABEL_NOT_FOUND);

    await assertProjectAccess(
      this.prisma,
      label.project.workspaceId,
      label.project.id,
      userId,
    );

    // Name uniqueness check — only when the name actually changes.
    if (dto.name && dto.name !== label.name) {
      const dup = await this.prisma.label.findUnique({
        where: {
          projectId_name: { projectId: label.project.id, name: dto.name },
        },
      });
      if (dup) throw new BadRequestException(MSG.ERROR.LABEL_ALREADY_EXISTS);
    }

    return this.prisma.label.update({
      where: { id: labelId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.color !== undefined && { color: dto.color }),
      },
    });
  }

  async delete(labelId: string, userId: string) {
    const label = await this.prisma.label.findUnique({
      where: { id: labelId },
      include: { project: { select: { id: true, workspaceId: true } } },
    });
    if (!label) throw new NotFoundException(MSG.ERROR.LABEL_NOT_FOUND);

    await assertProjectAccess(
      this.prisma,
      label.project.workspaceId,
      label.project.id,
      userId,
    );

    return this.prisma.label.delete({ where: { id: labelId } });
  }
}
