import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProjectType, StatusCategory } from '@prisma/client';
import { MSG } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import {
  ColumnNotFoundException,
  ProjectNotFoundException,
} from '@/core/exceptions';
import { assertProjectAccess } from '@/core/utils';
import { RealtimeEventsService } from '@/modules/events/events.service';
import { REALTIME_EVENTS } from '@/modules/events/events.types';
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
    private realtime: RealtimeEventsService,
  ) {}

  /** Fire-and-forget realtime emit for any column-structure change. */
  private emit(projectId: string, actorId: string) {
    this.realtime.emit({
      type: REALTIME_EVENTS.BOARD_CHANGED,
      actorId,
      projectId,
    });
  }

  async createDefaultBoard(
    projectId: string,
    projectName: string,
    type: string,
  ) {
    return this.prisma.board.create({
      data: {
        name: `${projectName} Board`,
        projectId,
        type: type as ProjectType,
        columns: { create: DEFAULT_COLUMNS },
      },
      include: { columns: { orderBy: { position: 'asc' } } },
    });
  }

  async findByProject(projectId: string, userId: string) {
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

    const created = await this.prisma.boardColumn.create({
      data: {
        boardId: board.id,
        name: dto.name,
        category: dto.category ?? StatusCategory.IN_PROGRESS,
        position: (maxPosition._max.position ?? -1) + 1,
        wipLimit: dto.wipLimit,
      },
    });
    this.emit(board.project.id, userId);
    return created;
  }

  async updateColumn(
    boardId: string,
    columnId: string,
    userId: string,
    dto: UpdateColumnDto,
  ) {
    const board = await this.assertBoardAccess(boardId, userId);

    const column = await this.prisma.boardColumn.findUnique({
      where: { id: columnId },
    });
    if (!column || column.boardId !== boardId) {
      throw new ColumnNotFoundException();
    }

    const updated = await this.prisma.boardColumn.update({
      where: { id: columnId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.wipLimit !== undefined && { wipLimit: dto.wipLimit }),
      },
    });
    this.emit(board.project.id, userId);
    return updated;
  }

  async deleteColumn(boardId: string, columnId: string, userId: string) {
    const board = await this.assertBoardAccess(boardId, userId);

    const column = await this.prisma.boardColumn.findUnique({
      where: { id: columnId },
    });
    if (!column || column.boardId !== boardId) {
      throw new ColumnNotFoundException();
    }

    // Deleting a column with issues silently orphans them — Prisma's
    // default `SetNull` cascade sets `Issue.boardColumnId = null` and
    // the card disappears from every board view. Refuse the delete so
    // the user is forced to move the issues first. The FE should show
    // the count + a "Move issues to ..." picker.
    const issueCount = await this.prisma.issue.count({
      where: { boardColumnId: columnId },
    });
    if (issueCount > 0) {
      throw new ConflictException(
        `Column has ${issueCount} issue(s). Move them to another column first.`,
      );
    }

    const result = await this.prisma.boardColumn.delete({
      where: { id: columnId },
    });
    this.emit(board.project.id, userId);
    return result;
  }

  async reorderColumns(
    boardId: string,
    userId: string,
    dto: ReorderColumnsDto,
  ) {
    const board = await this.assertBoardAccess(boardId, userId);

    // Verify every supplied id belongs to THIS board AND the supplied
    // list covers every column. Without these checks a caller could:
    //   1. Reposition columns from another board they admin
    //   2. Drop a column id from the list, leaving its position stale
    const existing = await this.prisma.boardColumn.findMany({
      where: { boardId },
      select: { id: true },
    });
    const existingSet = new Set(existing.map((c) => c.id));
    const incomingSet = new Set(dto.columnIds);
    if (incomingSet.size !== dto.columnIds.length) {
      throw new BadRequestException('Duplicate column id in reorder payload');
    }
    if (
      incomingSet.size !== existingSet.size ||
      dto.columnIds.some((id) => !existingSet.has(id))
    ) {
      throw new BadRequestException(
        'Reorder payload must list every column of this board exactly once',
      );
    }

    await this.prisma.$transaction(
      dto.columnIds.map((id, index) =>
        this.prisma.boardColumn.update({
          where: { id },
          data: { position: index },
        }),
      ),
    );

    const result = await this.prisma.boardColumn.findMany({
      where: { boardId },
      orderBy: { position: 'asc' },
    });
    this.emit(board.project.id, userId);
    return result;
  }

  // ─── Helpers ──────────────────────────────────────────

  private async assertBoardAccess(boardId: string, userId: string) {
    const board = await this.prisma.board.findUnique({
      where: { id: boardId },
      include: { project: { select: { id: true, workspaceId: true } } },
    });
    if (!board) throw new NotFoundException(MSG.ERROR.BOARD_NOT_FOUND);

    await assertProjectAccess(
      this.prisma,
      board.project.workspaceId,
      board.project.id,
      userId,
    );
    return board;
  }
}
