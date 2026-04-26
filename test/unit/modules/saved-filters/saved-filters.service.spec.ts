/**
 * Unit tests for SavedFiltersService.
 *
 * Critical contracts:
 *   - findAll() returns owner's filters + project-shared, both filtered by access
 *   - create() converts P2002 to ConflictException for friendly error
 *   - update()/delete() reject non-owners with ForbiddenException
 *   - All writes assert project access first
 */
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SavedFiltersService } from '@/modules/saved-filters/saved-filters.service';

function createMockPrisma() {
  return {
    savedFilter: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
}

function createMockProjects() {
  return {
    assertProjectAccess: jest.fn().mockResolvedValue(undefined),
  };
}

describe('SavedFiltersService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let projects: ReturnType<typeof createMockProjects>;
  let service: SavedFiltersService;

  beforeEach(() => {
    prisma = createMockPrisma();
    projects = createMockProjects();
    service = new SavedFiltersService(prisma as never, projects as never);
  });

  describe('findAll()', () => {
    it('asserts project access before reading', async () => {
      prisma.savedFilter.findMany.mockResolvedValue([]);
      await service.findAll('proj-1', 'user-1');
      expect(projects.assertProjectAccess).toHaveBeenCalledWith(
        'proj-1',
        'user-1',
      );
    });

    it('queries owner-or-shared per project', async () => {
      prisma.savedFilter.findMany.mockResolvedValue([]);
      await service.findAll('proj-1', 'user-1');
      const arg = prisma.savedFilter.findMany.mock.calls[0][0];
      expect(arg.where).toEqual({
        projectId: 'proj-1',
        OR: [{ ownerId: 'user-1' }, { shared: true }],
      });
    });

    it('propagates ForbiddenException from project guard', async () => {
      projects.assertProjectAccess.mockRejectedValueOnce(
        new ForbiddenException('NOT_PROJECT_MEMBER'),
      );
      await expect(service.findAll('proj-1', 'user-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.savedFilter.findMany).not.toHaveBeenCalled();
    });
  });

  describe('create()', () => {
    it('inserts filter with trimmed name + ownerId from caller', async () => {
      prisma.savedFilter.create.mockResolvedValue({ id: 'f1' });
      await service.create('user-1', {
        projectId: 'proj-1',
        name: '  My Filter  ',
        payload: { types: ['BUG'] },
        shared: true,
      });
      const arg = prisma.savedFilter.create.mock.calls[0][0];
      expect(arg.data).toMatchObject({
        projectId: 'proj-1',
        ownerId: 'user-1',
        name: 'My Filter',
        shared: true,
      });
    });

    it('defaults shared to false when omitted', async () => {
      prisma.savedFilter.create.mockResolvedValue({ id: 'f1' });
      await service.create('user-1', {
        projectId: 'proj-1',
        name: 'X',
        payload: {},
      });
      const arg = prisma.savedFilter.create.mock.calls[0][0];
      expect(arg.data.shared).toBe(false);
    });

    it('translates Prisma P2002 (unique violation) to ConflictException', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '7.6.0' },
      );
      prisma.savedFilter.create.mockRejectedValueOnce(p2002);
      await expect(
        service.create('user-1', {
          projectId: 'proj-1',
          name: 'dup',
          payload: {},
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rethrows non-P2002 errors unchanged', async () => {
      prisma.savedFilter.create.mockRejectedValueOnce(new Error('boom'));
      await expect(
        service.create('user-1', {
          projectId: 'proj-1',
          name: 'x',
          payload: {},
        }),
      ).rejects.toThrow('boom');
    });
  });

  describe('update()', () => {
    it('throws NotFound when filter does not exist', async () => {
      prisma.savedFilter.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.update('f-missing', 'user-1', { name: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws Forbidden when caller is not the owner', async () => {
      prisma.savedFilter.findUnique.mockResolvedValueOnce({
        id: 'f1',
        ownerId: 'someone-else',
      });
      await expect(
        service.update('f1', 'user-1', { name: 'x' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.savedFilter.update).not.toHaveBeenCalled();
    });

    it('only updates the fields explicitly passed (partial update)', async () => {
      prisma.savedFilter.findUnique.mockResolvedValueOnce({
        id: 'f1',
        ownerId: 'user-1',
      });
      prisma.savedFilter.update.mockResolvedValue({ id: 'f1' });
      await service.update('f1', 'user-1', { shared: true });
      const arg = prisma.savedFilter.update.mock.calls[0][0];
      // Only `shared` should appear; name + payload are absent.
      expect(arg.data).toEqual({ shared: true });
    });

    it('trims the new name when provided', async () => {
      prisma.savedFilter.findUnique.mockResolvedValueOnce({
        id: 'f1',
        ownerId: 'user-1',
      });
      prisma.savedFilter.update.mockResolvedValue({ id: 'f1' });
      await service.update('f1', 'user-1', { name: '  trimmed  ' });
      expect(prisma.savedFilter.update.mock.calls[0][0].data.name).toBe(
        'trimmed',
      );
    });
  });

  describe('delete()', () => {
    it('throws NotFound when filter does not exist', async () => {
      prisma.savedFilter.findUnique.mockResolvedValueOnce(null);
      await expect(service.delete('f1', 'user-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws Forbidden when caller is not the owner', async () => {
      prisma.savedFilter.findUnique.mockResolvedValueOnce({
        id: 'f1',
        ownerId: 'other',
      });
      await expect(service.delete('f1', 'user-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.savedFilter.delete).not.toHaveBeenCalled();
    });

    it('deletes when owner matches', async () => {
      prisma.savedFilter.findUnique.mockResolvedValueOnce({
        id: 'f1',
        ownerId: 'user-1',
      });
      prisma.savedFilter.delete.mockResolvedValueOnce({ id: 'f1' });
      await service.delete('f1', 'user-1');
      expect(prisma.savedFilter.delete).toHaveBeenCalledWith({
        where: { id: 'f1' },
      });
    });
  });
});
