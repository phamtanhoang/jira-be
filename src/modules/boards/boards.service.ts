import { Injectable, NotFoundException } from '@nestjs/common';
import { StatusCategory } from '@prisma/client';
import { MSG } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { WorkspacesService } from '@/modules/workspaces/workspaces.service';
import { CreateColumnDto, UpdateColumnDto, ReorderColumnsDto } from './dto';

const DEFAULT_COLUMNS = [
  { name: 'To Do', category: StatusCategory.TODO, position: 0 },
  { name: 'In Progress', category: StatusCategory.IN_PROGRESS, position: 1 },
  { name: 'Done', category: StatusCategory.DONE, position: 2 },
];

@Injectable()
export class BoardsService {
  constructor(
    private prisma: PrismaService,
    private workspacesService: WorkspacesService,
  ) {}

  async createDefaultBoard(projectId: string, projectName: string, type: string) {
    return this.prisma.board.create({
      data: {
        name: `${projectName} Board`,
        projectId,
        type: type as any,
        columns: { create: DEFAULT_COLUMNS },
      },
      include: { columns: { orderBy: { position: 'asc' } } },
    });
  }

  async findByProject(projectId: string, userId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException(MSG.ERROR.PROJECT_NOT_FOUND);

    await this.workspacesService.assertMember(project.workspaceId, userId);

    return this.prisma.board.findUnique({
      where: { projectId },
      include: {
        columns: {
          orderBy: { position: 'asc' },
          include: {
            issues: {
              orderBy: { position: 'asc' },
              include: {
                assignee: { select: { id: true, name: true, image: true } },
                labels: { include: { label: true } },
              },
            },
          },
        },
        sprints: { orderBy: { createdAt: 'desc' } },
      },
    });
  }

  // ─── Columns ──────────────────────────────────────────

  async addColumn(boardId: string, userId: string, dto: CreateColumnDto) {
    const board = await this.assertBoardAccess(boardId, userId);

    const maxPosition = await this.prisma.boardColumn.aggregate({
      where: { boardId },
      _max: { position: true },
    });

    return this.prisma.boardColumn.create({
      data: {
        boardId: board.id,
        name: dto.name,
        category: dto.category ?? StatusCategory.IN_PROGRESS,
        position: (maxPosition._max.position ?? -1) + 1,
        wipLimit: dto.wipLimit,
      },
    });
  }

  async updateColumn(boardId: string, columnId: string, userId: string, dto: UpdateColumnDto) {
    await this.assertBoardAccess(boardId, userId);

    const column = await this.prisma.boardColumn.findUnique({ where: { id: columnId } });
    if (!column || column.boardId !== boardId) {
      throw new NotFoundException(MSG.ERROR.COLUMN_NOT_FOUND);
    }

    return this.prisma.boardColumn.update({
      where: { id: columnId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.wipLimit !== undefined && { wipLimit: dto.wipLimit }),
      },
    });
  }

  async deleteColumn(boardId: string, columnId: string, userId: string) {
    await this.assertBoardAccess(boardId, userId);

    const column = await this.prisma.boardColumn.findUnique({ where: { id: columnId } });
    if (!column || column.boardId !== boardId) {
      throw new NotFoundException(MSG.ERROR.COLUMN_NOT_FOUND);
    }

    return this.prisma.boardColumn.delete({ where: { id: columnId } });
  }

  async reorderColumns(boardId: string, userId: string, dto: ReorderColumnsDto) {
    await this.assertBoardAccess(boardId, userId);

    await this.prisma.$transaction(
      dto.columnIds.map((id, index) =>
        this.prisma.boardColumn.update({
          where: { id },
          data: { position: index },
        }),
      ),
    );

    return this.prisma.boardColumn.findMany({
      where: { boardId },
      orderBy: { position: 'asc' },
    });
  }

  // ─── Helpers ──────────────────────────────────────────

  private async assertBoardAccess(boardId: string, userId: string) {
    const board = await this.prisma.board.findUnique({
      where: { id: boardId },
      include: { project: { select: { workspaceId: true } } },
    });
    if (!board) throw new NotFoundException(MSG.ERROR.BOARD_NOT_FOUND);

    await this.workspacesService.assertMember(board.project.workspaceId, userId);
    return board;
  }
}
