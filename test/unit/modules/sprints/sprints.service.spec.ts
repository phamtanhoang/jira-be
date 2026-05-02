/**
 * Unit tests for SprintsService.getBurndown().
 *
 * Key contracts:
 *   1. Returns { totalPoints: 0, days: [] } when sprint has no startDate
 *   2. Null storyPoints default to 1 per issue
 *   3. Does not divide by zero for 0-day sprints (startDate === endDate)
 *   4. Actual line is flat (equals totalPoints) when no issues are completed
 *   5. Ideal line reaches 0 on the last day
 *   6. First day actual equals totalPoints
 *   7. Actual reduces correctly as issues are completed
 */
import { SprintStatus } from '@prisma/client';
import { SprintsService } from '@/modules/sprints/sprints.service';

function createMockPrisma() {
  return {
    sprint: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    board: {
      findUnique: jest.fn(),
    },
    issue: {
      updateMany: jest.fn(),
    },
  };
}

function makeSprint(
  overrides: Partial<{
    id: string;
    boardId: string;
    startDate: Date | null;
    endDate: Date | null;
    status: SprintStatus;
    issues: Array<{
      id: string;
      storyPoints: number | null;
      completedAt: Date | null;
      assignee: null;
      boardColumn: { id: string; name: string; category: string } | null;
    }>;
  }> = {},
) {
  return {
    id: 'sprint-1',
    boardId: 'board-1',
    name: 'Sprint 1',
    goal: null,
    status: SprintStatus.ACTIVE,
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-01-14'),
    issues: [],
    _count: { issues: 0 },
    ...overrides,
  };
}

describe('SprintsService.getBurndown()', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: SprintsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new SprintsService(prisma as never);
  });

  it('returns empty result when sprint has no startDate', async () => {
    jest
      .spyOn(service, 'findById')
      .mockResolvedValueOnce(makeSprint({ startDate: null }) as never);
    const result = await service.getBurndown('sprint-1', 'user-1');
    expect(result).toEqual({ totalPoints: 0, days: [] });
  });

  it('defaults null storyPoints to 1 per issue', async () => {
    const startDate = new Date('2026-01-01');
    const endDate = new Date('2026-01-02'); // 1-day sprint
    jest.spyOn(service, 'findById').mockResolvedValueOnce(
      makeSprint({
        startDate,
        endDate,
        issues: [
          {
            id: 'i1',
            storyPoints: null,
            completedAt: null,
            assignee: null,
            boardColumn: null,
          },
          {
            id: 'i2',
            storyPoints: null,
            completedAt: null,
            assignee: null,
            boardColumn: null,
          },
        ],
      }) as never,
    );
    const result = await service.getBurndown('sprint-1', 'user-1');
    // 2 issues × 1 point each = 2 total
    expect(result.totalPoints).toBe(2);
  });

  it('does not divide by zero for 0-day sprint (startDate === endDate)', async () => {
    const sameDay = new Date('2026-01-01');
    jest.spyOn(service, 'findById').mockResolvedValueOnce(
      makeSprint({
        startDate: sameDay,
        endDate: sameDay,
        issues: [
          {
            id: 'i1',
            storyPoints: 5,
            completedAt: null,
            assignee: null,
            boardColumn: null,
          },
        ],
      }) as never,
    );
    // Should not throw
    const result = await service.getBurndown('sprint-1', 'user-1');
    expect(result.totalPoints).toBe(5);
    expect(result.days.length).toBeGreaterThanOrEqual(1);
  });

  it('actual line is flat (equals totalPoints) when no issues are completed', async () => {
    const startDate = new Date('2026-01-01');
    const endDate = new Date('2026-01-05');
    jest.spyOn(service, 'findById').mockResolvedValueOnce(
      makeSprint({
        startDate,
        endDate,
        issues: [
          {
            id: 'i1',
            storyPoints: 3,
            completedAt: null,
            assignee: null,
            boardColumn: null,
          },
          {
            id: 'i2',
            storyPoints: 2,
            completedAt: null,
            assignee: null,
            boardColumn: null,
          },
        ],
      }) as never,
    );
    const result = await service.getBurndown('sprint-1', 'user-1');
    // Every day's actual should equal totalPoints (5) since nothing is done
    for (const day of result.days) {
      expect(day.actual).toBe(5);
    }
  });

  it('ideal line reaches 0 on the last day', async () => {
    const startDate = new Date('2026-01-01');
    const endDate = new Date('2026-01-05');
    jest.spyOn(service, 'findById').mockResolvedValueOnce(
      makeSprint({
        startDate,
        endDate,
        issues: [
          {
            id: 'i1',
            storyPoints: 10,
            completedAt: null,
            assignee: null,
            boardColumn: null,
          },
        ],
      }) as never,
    );
    const result = await service.getBurndown('sprint-1', 'user-1');
    const lastDay = result.days[result.days.length - 1];
    expect(lastDay.ideal).toBe(0);
  });

  it('first day actual equals totalPoints (invariant)', async () => {
    const startDate = new Date('2026-01-01');
    const endDate = new Date('2026-01-07');
    jest.spyOn(service, 'findById').mockResolvedValueOnce(
      makeSprint({
        startDate,
        endDate,
        issues: [
          {
            id: 'i1',
            storyPoints: 8,
            completedAt: null,
            assignee: null,
            boardColumn: null,
          },
          {
            id: 'i2',
            storyPoints: 2,
            completedAt: null,
            assignee: null,
            boardColumn: null,
          },
        ],
      }) as never,
    );
    const result = await service.getBurndown('sprint-1', 'user-1');
    expect(result.days[0].actual).toBe(result.totalPoints);
  });

  it('reduces actual correctly when 50% of points are completed', async () => {
    const startDate = new Date('2026-01-01');
    const endDate = new Date('2026-01-07');
    const completedAt = new Date('2026-01-03'); // completed on day 3
    jest.spyOn(service, 'findById').mockResolvedValueOnce(
      makeSprint({
        startDate,
        endDate,
        issues: [
          {
            id: 'i1',
            storyPoints: 5,
            completedAt,
            assignee: null,
            boardColumn: null,
          },
          {
            id: 'i2',
            storyPoints: 5,
            completedAt: null,
            assignee: null,
            boardColumn: null,
          },
        ],
      }) as never,
    );
    const result = await service.getBurndown('sprint-1', 'user-1');
    // After day 3, actual should be 5 (10 total - 5 done)
    const day3 = result.days.find((d) => d.date === '2026-01-03');
    expect(day3?.actual).toBe(5);
  });
});
