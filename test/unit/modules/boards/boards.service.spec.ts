/**
 * Unit tests for BoardsService.reorderColumns().
 *
 * The DTO already guards array shape (length, UUID format). What this
 * suite pins is the SERVICE-LEVEL invariants that no validator can
 * enforce:
 *
 *   1. The list must cover every column of the board exactly once —
 *      partial reorders would leave the omitted columns at stale
 *      positions (silent corruption).
 *   2. No column id from a different board is allowed — an admin of
 *      board A must not be able to reposition columns of board B.
 *   3. All position updates happen inside a single $transaction so a
 *      failure mid-way leaves no half-applied state.
 *   4. The realtime `board.changed` event fires AFTER the transaction
 *      commits — not inside it (otherwise a rolled-back txn still
 *      notifies clients to refetch nothing).
 *   5. The function emits the correct projectId so subscribers on the
 *      right channel receive the event.
 *   6. Access is gated by `assertProjectAccess` (workspace OWNER/ADMIN
 *      bypass; everyone else needs an explicit ProjectMember row).
 */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { BoardsService } from '@/modules/boards/boards.service';

const BOARD_ID = 'b0000000-0000-0000-0000-000000000001';
const PROJECT_ID = 'p0000000-0000-0000-0000-000000000001';
const WORKSPACE_ID = 'w0000000-0000-0000-0000-000000000001';
const USER_ID = 'u0000000-0000-0000-0000-000000000001';
const COL_A = 'c0000000-0000-0000-0000-00000000000a';
const COL_B = 'c0000000-0000-0000-0000-00000000000b';
const COL_C = 'c0000000-0000-0000-0000-00000000000c';

function createMockPrisma() {
  const txCalls: unknown[][] = [];
  const mock = {
    board: {
      findUnique: jest.fn(),
    },
    boardColumn: {
      findMany: jest.fn(),
      update: jest.fn((args: unknown) => ({ __op: 'update', args })),
    },
    workspaceMember: {
      // Default: caller is a workspace OWNER so assertProjectAccess
      // short-circuits without consulting projectMember. Each test can
      // override per call.
      findUnique: jest.fn().mockResolvedValue({ role: 'OWNER' }),
    },
    projectMember: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    // The reorder code uses the ARRAY form of $transaction
    // (`prisma.$transaction([promise, promise, ...])`), unlike the
    // callback form used by comments. We capture the array so tests can
    // assert "exactly N updates, in this order".
    $transaction: jest.fn((ops: unknown[]) => {
      txCalls.push(ops);
      return Promise.resolve(ops); // resolved array of "update" stubs
    }),
    __txCalls: txCalls,
  };
  return mock;
}

function createMockRealtime() {
  return {
    emit: jest.fn(),
  };
}

function makeBoard(overrides: Partial<{ id: string; projectId: string }> = {}) {
  return {
    id: overrides.id ?? BOARD_ID,
    project: {
      id: overrides.projectId ?? PROJECT_ID,
      workspaceId: WORKSPACE_ID,
    },
  };
}

describe('BoardsService.reorderColumns()', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let realtime: ReturnType<typeof createMockRealtime>;
  let service: BoardsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    realtime = createMockRealtime();
    prisma.board.findUnique.mockResolvedValue(makeBoard());
    prisma.boardColumn.findMany
      // First call inside reorder: existing column ids
      .mockResolvedValueOnce([{ id: COL_A }, { id: COL_B }, { id: COL_C }])
      // Second call: result after reorder
      .mockResolvedValueOnce([
        { id: COL_B, position: 0 },
        { id: COL_A, position: 1 },
        { id: COL_C, position: 2 },
      ]);
    service = new BoardsService(prisma as never, realtime as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('happy path', () => {
    it('updates every column with its new position inside one $transaction', async () => {
      await service.reorderColumns(BOARD_ID, USER_ID, {
        columnIds: [COL_B, COL_A, COL_C],
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const ops = prisma.$transaction.mock.calls[0][0] as Array<{
        __op: string;
        args: { where: { id: string }; data: { position: number } };
      }>;
      expect(ops).toHaveLength(3);
      expect(ops[0].args).toEqual({
        where: { id: COL_B },
        data: { position: 0 },
      });
      expect(ops[1].args).toEqual({
        where: { id: COL_A },
        data: { position: 1 },
      });
      expect(ops[2].args).toEqual({
        where: { id: COL_C },
        data: { position: 2 },
      });
    });

    it('emits board.changed realtime event with the correct projectId', async () => {
      await service.reorderColumns(BOARD_ID, USER_ID, {
        columnIds: [COL_B, COL_A, COL_C],
      });
      expect(realtime.emit).toHaveBeenCalledTimes(1);
      expect(realtime.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: PROJECT_ID,
          actorId: USER_ID,
        }),
      );
    });

    it('emit happens AFTER $transaction (not inside it)', async () => {
      // Spy on the order: $transaction must resolve before emit fires.
      const order: string[] = [];
      prisma.$transaction.mockImplementationOnce((ops: unknown[]) => {
        order.push('tx');
        return Promise.resolve(ops);
      });
      realtime.emit.mockImplementationOnce(() => {
        order.push('emit');
      });
      await service.reorderColumns(BOARD_ID, USER_ID, {
        columnIds: [COL_B, COL_A, COL_C],
      });
      expect(order).toEqual(['tx', 'emit']);
    });

    it('returns the columns ordered by their new positions', async () => {
      const result = await service.reorderColumns(BOARD_ID, USER_ID, {
        columnIds: [COL_B, COL_A, COL_C],
      });
      expect(result).toEqual([
        { id: COL_B, position: 0 },
        { id: COL_A, position: 1 },
        { id: COL_C, position: 2 },
      ]);
    });

    it('preserves a no-op reorder (same order in == same order out) — still emits', async () => {
      // No "skip emit if identical" optimisation today; teammates on
      // other tabs may have drag-and-drop UIs that benefit from the
      // ack. Pin current behavior so an accidental optimisation gets
      // flagged.
      await service.reorderColumns(BOARD_ID, USER_ID, {
        columnIds: [COL_A, COL_B, COL_C],
      });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(realtime.emit).toHaveBeenCalledTimes(1);
    });
  });

  describe('validation', () => {
    it('rejects duplicate column ids with BadRequestException', async () => {
      await expect(
        service.reorderColumns(BOARD_ID, USER_ID, {
          columnIds: [COL_A, COL_A, COL_C],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(realtime.emit).not.toHaveBeenCalled();
    });

    it('rejects an incomplete list (missing one column)', async () => {
      await expect(
        service.reorderColumns(BOARD_ID, USER_ID, {
          columnIds: [COL_A, COL_B], // missing COL_C
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a list containing an id from a DIFFERENT board', async () => {
      const FOREIGN = 'f0000000-0000-0000-0000-00000000ffff';
      await expect(
        service.reorderColumns(BOARD_ID, USER_ID, {
          columnIds: [COL_A, COL_B, FOREIGN],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an oversize list (extra ids)', async () => {
      const EXTRA = 'e0000000-0000-0000-0000-00000000eeee';
      await expect(
        service.reorderColumns(BOARD_ID, USER_ID, {
          columnIds: [COL_A, COL_B, COL_C, EXTRA],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an empty list (covers no columns)', async () => {
      await expect(
        service.reorderColumns(BOARD_ID, USER_ID, { columnIds: [] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('does NOT write to the DB when validation fails', async () => {
      await expect(
        service.reorderColumns(BOARD_ID, USER_ID, {
          columnIds: [COL_A, COL_A, COL_C],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.boardColumn.update).not.toHaveBeenCalled();
    });
  });

  describe('access control', () => {
    it('throws NotFoundException when the board does not exist', async () => {
      prisma.board.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.reorderColumns(BOARD_ID, USER_ID, {
          columnIds: [COL_A, COL_B, COL_C],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when the user is not a workspace member', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.reorderColumns(BOARD_ID, USER_ID, {
          columnIds: [COL_A, COL_B, COL_C],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws ForbiddenException when workspace member but not a project member (non-OWNER/ADMIN)', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValueOnce({
        role: 'MEMBER',
      });
      prisma.projectMember.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.reorderColumns(BOARD_ID, USER_ID, {
          columnIds: [COL_A, COL_B, COL_C],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows workspace ADMIN even without explicit project membership', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValueOnce({
        role: 'ADMIN',
      });
      prisma.projectMember.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.reorderColumns(BOARD_ID, USER_ID, {
          columnIds: [COL_B, COL_A, COL_C],
        }),
      ).resolves.toBeDefined();
    });

    it('allows project DEVELOPER as long as workspace membership is present', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValueOnce({
        role: 'MEMBER',
      });
      prisma.projectMember.findUnique.mockResolvedValueOnce({
        role: 'DEVELOPER',
      });
      await expect(
        service.reorderColumns(BOARD_ID, USER_ID, {
          columnIds: [COL_B, COL_A, COL_C],
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('transaction atomicity', () => {
    it('does NOT emit realtime when $transaction rejects', async () => {
      prisma.$transaction.mockRejectedValueOnce(
        new Error('DB serialization failure'),
      );
      await expect(
        service.reorderColumns(BOARD_ID, USER_ID, {
          columnIds: [COL_B, COL_A, COL_C],
        }),
      ).rejects.toThrow('DB serialization failure');
      expect(realtime.emit).not.toHaveBeenCalled();
    });

    it('passes the FULL update array to $transaction in a single call (no per-row sequential awaits)', async () => {
      await service.reorderColumns(BOARD_ID, USER_ID, {
        columnIds: [COL_B, COL_A, COL_C],
      });
      // One $transaction call, with all 3 updates in the array.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const ops = prisma.$transaction.mock.calls[0][0];
      expect(ops).toHaveLength(3);
    });
  });
});
