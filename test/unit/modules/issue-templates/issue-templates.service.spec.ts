/**
 * Unit tests for IssueTemplatesService.
 *
 * Critical contracts:
 *   - List uses project-access guard (any role can read)
 *   - Create/update/delete require LEAD or ADMIN — VIEWER and DEVELOPER blocked
 *   - P2002 (unique name per project) → ConflictException
 *   - Update is partial (only specified fields written)
 */
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProjectRole } from '@prisma/client';
import { IssueTemplatesService } from '@/modules/issue-templates/issue-templates.service';

function createMockPrisma() {
  return {
    issueTemplate: {
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
    assertRole: jest.fn().mockResolvedValue(undefined),
  };
}

describe('IssueTemplatesService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let projects: ReturnType<typeof createMockProjects>;
  let service: IssueTemplatesService;

  beforeEach(() => {
    prisma = createMockPrisma();
    projects = createMockProjects();
    service = new IssueTemplatesService(prisma as never, projects as never);
  });

  describe('findAll()', () => {
    it('uses project-access (not role) so VIEWERs can pick templates', async () => {
      prisma.issueTemplate.findMany.mockResolvedValue([]);
      await service.findAll('proj-1', 'viewer-1');
      expect(projects.assertProjectAccess).toHaveBeenCalledWith(
        'proj-1',
        'viewer-1',
      );
      expect(projects.assertRole).not.toHaveBeenCalled();
    });

    it('orders templates alphabetically by name', async () => {
      prisma.issueTemplate.findMany.mockResolvedValue([]);
      await service.findAll('proj-1', 'user-1');
      const arg = prisma.issueTemplate.findMany.mock.calls[0][0];
      expect(arg.orderBy).toEqual({ name: 'asc' });
    });
  });

  describe('create()', () => {
    it('requires LEAD or ADMIN role', async () => {
      prisma.issueTemplate.create.mockResolvedValue({ id: 't1' });
      await service.create('user-1', {
        projectId: 'proj-1',
        name: 'Bug',
      });
      expect(projects.assertRole).toHaveBeenCalledWith('proj-1', 'user-1', [
        ProjectRole.LEAD,
        ProjectRole.ADMIN,
      ]);
    });

    it('rejects DEVELOPER (assertRole throws ForbiddenException)', async () => {
      projects.assertRole.mockRejectedValueOnce(
        new ForbiddenException('INSUFFICIENT_PERMISSIONS'),
      );
      await expect(
        service.create('dev-1', { projectId: 'proj-1', name: 'X' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.issueTemplate.create).not.toHaveBeenCalled();
    });

    it('defaults type to TASK and labels to empty array', async () => {
      prisma.issueTemplate.create.mockResolvedValue({ id: 't1' });
      await service.create('user-1', {
        projectId: 'proj-1',
        name: 'X',
      });
      const arg = prisma.issueTemplate.create.mock.calls[0][0];
      expect(arg.data.type).toBe('TASK');
      expect(arg.data.defaultLabels).toEqual([]);
    });

    it('trims the name', async () => {
      prisma.issueTemplate.create.mockResolvedValue({ id: 't1' });
      await service.create('user-1', {
        projectId: 'proj-1',
        name: '  Spaced  ',
      });
      expect(prisma.issueTemplate.create.mock.calls[0][0].data.name).toBe(
        'Spaced',
      );
    });

    it('translates P2002 to ConflictException (duplicate name in project)', async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: '7.6.0',
      });
      prisma.issueTemplate.create.mockRejectedValueOnce(p2002);
      await expect(
        service.create('user-1', { projectId: 'proj-1', name: 'dup' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('update()', () => {
    it('throws NotFound when template does not exist', async () => {
      prisma.issueTemplate.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.update('t-missing', 'user-1', { name: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(projects.assertRole).not.toHaveBeenCalled();
    });

    it('checks role on the OWNING project (not caller-supplied)', async () => {
      prisma.issueTemplate.findUnique.mockResolvedValueOnce({
        id: 't1',
        projectId: 'proj-real',
      });
      prisma.issueTemplate.update.mockResolvedValue({ id: 't1' });
      await service.update('t1', 'user-1', { name: 'x' });
      // Should look up by t1 then enforce role on proj-real
      expect(projects.assertRole).toHaveBeenCalledWith('proj-real', 'user-1', [
        ProjectRole.LEAD,
        ProjectRole.ADMIN,
      ]);
    });

    it('only writes the fields explicitly passed', async () => {
      prisma.issueTemplate.findUnique.mockResolvedValueOnce({
        id: 't1',
        projectId: 'proj-1',
      });
      prisma.issueTemplate.update.mockResolvedValue({ id: 't1' });
      await service.update('t1', 'user-1', { defaultLabels: ['l1'] });
      const arg = prisma.issueTemplate.update.mock.calls[0][0];
      expect(arg.data).toEqual({ defaultLabels: ['l1'] });
    });
  });

  describe('delete()', () => {
    it('throws NotFound when template does not exist', async () => {
      prisma.issueTemplate.findUnique.mockResolvedValueOnce(null);
      await expect(service.delete('t1', 'user-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects DEVELOPER via assertRole', async () => {
      prisma.issueTemplate.findUnique.mockResolvedValueOnce({
        id: 't1',
        projectId: 'proj-1',
      });
      projects.assertRole.mockRejectedValueOnce(
        new ForbiddenException('INSUFFICIENT_PERMISSIONS'),
      );
      await expect(service.delete('t1', 'user-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.issueTemplate.delete).not.toHaveBeenCalled();
    });

    it('deletes when role check passes', async () => {
      prisma.issueTemplate.findUnique.mockResolvedValueOnce({
        id: 't1',
        projectId: 'proj-1',
      });
      prisma.issueTemplate.delete.mockResolvedValueOnce({ id: 't1' });
      await service.delete('t1', 'user-1');
      expect(prisma.issueTemplate.delete).toHaveBeenCalledWith({
        where: { id: 't1' },
      });
    });
  });
});
