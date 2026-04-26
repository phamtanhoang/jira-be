import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SprintStatus, StatusCategory } from '@prisma/client';
import { MSG } from '@/core/constants';
import { PrismaService } from '@/core/database/prisma.service';
import { assertProjectAccess } from '@/core/utils';
import { CreateSprintDto, UpdateSprintDto } from './dto';

type DailyStatusRow = { day: Date; category: StatusCategory; count: bigint };

@Injectable()
export class SprintsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Cumulative Flow Diagram data — for each day in the window, count of issues
   * by status category. Reconstructs the historical column from `Activity`
   * rows (`field = boardColumnId`) so the chart shows real transitions, not
   * just a flat "current state" snapshot. Issues never moved fall back to
   * their current column (correct since they've been there since creation).
   *
   * Window is bounded to [7..90] days by the controller's DTO.
   */
  async getCumulativeFlow(boardId: string, userId: string, days: number) {
    await this.assertBoardAccess(boardId, userId);

    const board = await this.prisma.board.findUnique({
      where: { id: boardId },
      select: { projectId: true },
    });
    if (!board) throw new NotFoundException(MSG.ERROR.BOARD_NOT_FOUND);

    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (days - 1));

    const rows = await this.prisma.$queryRaw<DailyStatusRow[]>`
      WITH RECURSIVE
      day_series AS (
        SELECT generate_series(
          ${since}::date,
          CURRENT_DATE,
          '1 day'::interval
        )::date AS day
      ),
      issue_state AS (
        SELECT
          i."id" AS "issueId",
          d.day,
          -- Latest column transition at end of the day. If none yet, fall back
          -- to the column the issue was first moved FROM (preserving original
          -- placement). If never moved at all, use current boardColumnId.
          COALESCE(
            (
              SELECT a."newValue"
              FROM "Activity" a
              WHERE a."issueId" = i."id"
                AND a."field" = 'boardColumnId'
                AND a."createdAt" < (d.day + INTERVAL '1 day')
              ORDER BY a."createdAt" DESC
              LIMIT 1
            ),
            (
              SELECT a."oldValue"
              FROM "Activity" a
              WHERE a."issueId" = i."id"
                AND a."field" = 'boardColumnId'
              ORDER BY a."createdAt" ASC
              LIMIT 1
            ),
            i."boardColumnId"
          ) AS col_id
        FROM day_series d
        CROSS JOIN "Issue" i
        WHERE i."projectId" = ${board.projectId}
          AND i."createdAt" < (d.day + INTERVAL '1 day')
      )
      SELECT
        iss.day,
        bc."category",
        COUNT(*)::bigint AS "count"
      FROM issue_state iss
      LEFT JOIN "BoardColumn" bc ON bc."id" = iss.col_id
      WHERE bc."category" IS NOT NULL
      GROUP BY iss.day, bc."category"
      ORDER BY iss.day ASC
    `;

    const dayKeys: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
      dayKeys.push(d.toISOString().slice(0, 10));
    }

    const map = new Map<
      string,
      { TODO: number; IN_PROGRESS: number; DONE: number }
    >();
    for (const k of dayKeys) {
      map.set(k, { TODO: 0, IN_PROGRESS: 0, DONE: 0 });
    }
    for (const r of rows) {
      const key = r.day.toISOString().slice(0, 10);
      const slot = map.get(key);
      if (slot) slot[r.category] = Number(r.count);
    }

    return {
      data: dayKeys.map((day) => ({ day, ...map.get(day)! })),
    };
  }

  async create(userId: string, dto: CreateSprintDto) {
    await this.assertBoardAccess(dto.boardId, userId);

    return this.prisma.sprint.create({
      data: {
        boardId: dto.boardId,
        name: dto.name,
        goal: dto.goal,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
    });
  }

  async findById(sprintId: string, userId: string) {
    const sprint = await this.prisma.sprint.findUnique({
      where: { id: sprintId },
      include: {
        issues: {
          orderBy: { position: 'asc' },
          include: {
            assignee: { select: { id: true, name: true, image: true } },
            boardColumn: { select: { id: true, name: true, category: true } },
          },
        },
        _count: { select: { issues: true } },
      },
    });
    if (!sprint) throw new NotFoundException(MSG.ERROR.SPRINT_NOT_FOUND);

    await this.assertBoardAccess(sprint.boardId, userId);
    return sprint;
  }

  async update(sprintId: string, userId: string, dto: UpdateSprintDto) {
    const sprint = await this.findById(sprintId, userId);

    return this.prisma.sprint.update({
      where: { id: sprint.id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.goal !== undefined && { goal: dto.goal }),
        ...(dto.startDate !== undefined && {
          startDate: new Date(dto.startDate),
        }),
        ...(dto.endDate !== undefined && { endDate: new Date(dto.endDate) }),
      },
    });
  }

  async start(sprintId: string, userId: string) {
    const sprint = await this.findById(sprintId, userId);

    // Check no other active sprint on same board
    const activeSprint = await this.prisma.sprint.findFirst({
      where: { boardId: sprint.boardId, status: SprintStatus.ACTIVE },
    });
    if (activeSprint)
      throw new BadRequestException(MSG.ERROR.SPRINT_ALREADY_ACTIVE);

    return this.prisma.sprint.update({
      where: { id: sprint.id },
      data: {
        status: SprintStatus.ACTIVE,
        startDate: sprint.startDate ?? new Date(),
      },
    });
  }

  async complete(sprintId: string, userId: string) {
    const sprint = await this.findById(sprintId, userId);
    if (sprint.status !== SprintStatus.ACTIVE) {
      throw new BadRequestException(MSG.ERROR.SPRINT_NOT_ACTIVE);
    }

    // Move incomplete issues back to backlog (unset sprintId)
    await this.prisma.issue.updateMany({
      where: {
        sprintId: sprint.id,
        boardColumn: { category: { not: StatusCategory.DONE } },
      },
      data: { sprintId: null },
    });

    return this.prisma.sprint.update({
      where: { id: sprint.id },
      data: { status: SprintStatus.COMPLETED, endDate: new Date() },
    });
  }

  async delete(sprintId: string, userId: string) {
    const sprint = await this.findById(sprintId, userId);

    // Unassign issues from this sprint
    await this.prisma.issue.updateMany({
      where: { sprintId: sprint.id },
      data: { sprintId: null },
    });

    return this.prisma.sprint.delete({ where: { id: sprint.id } });
  }

  async getBurndown(sprintId: string, userId: string) {
    const sprint = await this.findById(sprintId, userId);
    if (!sprint.startDate) return { totalPoints: 0, days: [] };

    const startDate = new Date(sprint.startDate);
    const endDate = sprint.endDate ? new Date(sprint.endDate) : new Date();

    // All issues in this sprint
    const issues = sprint.issues;
    const totalPoints = issues.reduce(
      (sum, i) => sum + (i.storyPoints ?? 1),
      0,
    );

    // Build daily burndown
    const totalDays = Math.max(
      1,
      Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000),
    );
    const pointsPerDay = totalPoints / totalDays;

    const days: { date: string; ideal: number; actual: number }[] = [];

    for (let d = 0; d <= totalDays; d++) {
      const currentDate = new Date(startDate);
      currentDate.setDate(currentDate.getDate() + d);
      const dateStr = currentDate.toISOString().slice(0, 10);

      // Count points completed by this date (issues with completedAt <= currentDate)
      const donePoints = issues
        .filter(
          (i) =>
            i.completedAt &&
            new Date(i.completedAt).toISOString().slice(0, 10) <= dateStr,
        )
        .reduce((sum, i) => sum + (i.storyPoints ?? 1), 0);

      days.push({
        date: dateStr,
        ideal: Math.max(
          0,
          Math.round((totalPoints - pointsPerDay * d) * 10) / 10,
        ),
        actual: totalPoints - donePoints,
      });
    }

    return { totalPoints, days };
  }

  /**
   * Velocity report: per past sprint, compute committed (sum of all story
   * points planned at completion time) vs completed (points whose issues
   * landed in a DONE column). Returns sprints in chronological order plus
   * a 3-sprint moving average that the FE shows as "predicted next".
   */
  async getVelocity(boardId: string, userId: string) {
    await this.assertBoardAccess(boardId, userId);

    const sprints = await this.prisma.sprint.findMany({
      where: {
        boardId,
        status: { in: [SprintStatus.COMPLETED, SprintStatus.CLOSED] },
      },
      include: {
        issues: {
          select: {
            storyPoints: true,
            completedAt: true,
            boardColumn: { select: { category: true } },
          },
        },
      },
      orderBy: { endDate: 'asc' },
      take: 12, // hard cap so the chart stays readable on small boards
    });

    const data = sprints.map((s) => {
      const committed = s.issues.reduce(
        (sum, i) => sum + (i.storyPoints ?? 0),
        0,
      );
      const completed = s.issues
        .filter((i) => i.boardColumn?.category === StatusCategory.DONE)
        .reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);
      return {
        sprintId: s.id,
        name: s.name,
        endDate: s.endDate,
        committed,
        completed,
      };
    });

    // 3-sprint trailing average of completed points → "predicted" capacity
    // for the next sprint. Falls back to the latest single sprint when fewer
    // than 3 historical sprints exist.
    const recent = data.slice(-3);
    const predicted = recent.length
      ? Math.round(
          recent.reduce((sum, d) => sum + d.completed, 0) / recent.length,
        )
      : 0;

    return { data, predicted };
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
