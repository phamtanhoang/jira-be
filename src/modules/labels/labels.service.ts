import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MSG } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { WorkspacesService } from '@/modules/workspaces/workspaces.service';
import { CreateLabelDto } from './dto';

@Injectable()
export class LabelsService {
  constructor(
    private prisma: PrismaService,
    private workspacesService: WorkspacesService,
  ) {}

  async create(userId: string, dto: CreateLabelDto) {
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
    });
    if (!project) throw new NotFoundException(MSG.ERROR.PROJECT_NOT_FOUND);

    await this.workspacesService.assertMember(project.workspaceId, userId);

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
    if (!project) throw new NotFoundException(MSG.ERROR.PROJECT_NOT_FOUND);

    await this.workspacesService.assertMember(project.workspaceId, userId);

    return this.prisma.label.findMany({
      where: { projectId },
      include: { _count: { select: { issues: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async delete(labelId: string, userId: string) {
    const label = await this.prisma.label.findUnique({
      where: { id: labelId },
      include: { project: { select: { workspaceId: true } } },
    });
    if (!label) throw new NotFoundException(MSG.ERROR.LABEL_NOT_FOUND);

    await this.workspacesService.assertMember(
      label.project.workspaceId,
      userId,
    );

    return this.prisma.label.delete({ where: { id: labelId } });
  }
}
