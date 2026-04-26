import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProjectRole } from '@prisma/client';
import { MSG } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { sanitizeRichHtml } from '@/core/utils';
import { ProjectsService } from '@/modules/projects/projects.service';
import { CreateIssueTemplateDto, UpdateIssueTemplateDto } from './dto';

const MANAGE_ROLES: ProjectRole[] = [ProjectRole.LEAD, ProjectRole.ADMIN];

@Injectable()
export class IssueTemplatesService {
  constructor(
    private prisma: PrismaService,
    private projectsService: ProjectsService,
  ) {}

  // Anyone with project access can list templates so the "Create from
  // template" picker works for everyone, even VIEWER roles.
  async findAll(projectId: string, userId: string) {
    await this.projectsService.assertProjectAccess(projectId, userId);
    return this.prisma.issueTemplate.findMany({
      where: { projectId },
      orderBy: { name: 'asc' },
    });
  }

  async create(userId: string, dto: CreateIssueTemplateDto) {
    await this.projectsService.assertRole(dto.projectId, userId, MANAGE_ROLES);
    try {
      return await this.prisma.issueTemplate.create({
        data: {
          projectId: dto.projectId,
          name: dto.name.trim(),
          type: dto.type ?? 'TASK',
          descriptionHtml: dto.descriptionHtml
            ? sanitizeRichHtml(dto.descriptionHtml)
            : dto.descriptionHtml,
          defaultPriority: dto.defaultPriority,
          defaultLabels: dto.defaultLabels ?? [],
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(MSG.ERROR.ISSUE_TEMPLATE_NAME_EXISTS);
      }
      throw err;
    }
  }

  async update(id: string, userId: string, dto: UpdateIssueTemplateDto) {
    const tpl = await this.prisma.issueTemplate.findUnique({ where: { id } });
    if (!tpl) throw new NotFoundException(MSG.ERROR.ISSUE_TEMPLATE_NOT_FOUND);
    await this.projectsService.assertRole(tpl.projectId, userId, MANAGE_ROLES);
    try {
      return await this.prisma.issueTemplate.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.type !== undefined && { type: dto.type }),
          ...(dto.descriptionHtml !== undefined && {
            descriptionHtml: dto.descriptionHtml
              ? sanitizeRichHtml(dto.descriptionHtml)
              : dto.descriptionHtml,
          }),
          ...(dto.defaultPriority !== undefined && {
            defaultPriority: dto.defaultPriority,
          }),
          ...(dto.defaultLabels !== undefined && {
            defaultLabels: dto.defaultLabels,
          }),
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(MSG.ERROR.ISSUE_TEMPLATE_NAME_EXISTS);
      }
      throw err;
    }
  }

  async delete(id: string, userId: string) {
    const tpl = await this.prisma.issueTemplate.findUnique({ where: { id } });
    if (!tpl) throw new NotFoundException(MSG.ERROR.ISSUE_TEMPLATE_NOT_FOUND);
    await this.projectsService.assertRole(tpl.projectId, userId, MANAGE_ROLES);
    await this.prisma.issueTemplate.delete({ where: { id } });
  }
}
