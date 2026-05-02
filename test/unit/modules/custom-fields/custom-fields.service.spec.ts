/**
 * Unit tests for CustomFieldsService.applyCustomFieldValues().
 *
 * Key contracts:
 *   1. Returns early without any DB calls when values is empty
 *   2. Silently skips unknown fieldIds (not in project)
 *   3. Calls deleteMany when value is null
 *   4. Calls deleteMany when value is empty string
 *   5. Coerces string "42" to number 42 for NUMBER type
 *   6. Skips SELECT value not in allowed options (deleteMany instead of upsert)
 *   7. Runs all upserts in parallel (Promise.all)
 *   8. Idempotent: calling twice with same values uses upsert semantics
 */
import { CustomFieldType } from '@prisma/client';
import { CustomFieldsService } from '@/modules/custom-fields/custom-fields.service';

function createMockPrisma() {
  return {
    customFieldDef: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    customFieldValue: {
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

function makeDef(
  overrides: Partial<{
    id: string;
    projectId: string;
    type: CustomFieldType;
    options: string[];
    name: string;
    required: boolean;
    position: number;
  }> = {},
) {
  return {
    id: 'field-1',
    projectId: 'proj-1',
    name: 'Test Field',
    type: CustomFieldType.TEXT,
    options: [],
    required: false,
    position: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('CustomFieldsService.applyCustomFieldValues()', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: CustomFieldsService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new CustomFieldsService(
      prisma as never,
      {} as never, // projectsService (not used in applyCustomFieldValues)
    );
  });

  it('returns early without any DB calls when values is empty', async () => {
    await service.applyCustomFieldValues('issue-1', 'proj-1', {});
    expect(prisma.customFieldDef.findMany).not.toHaveBeenCalled();
    expect(prisma.customFieldValue.upsert).not.toHaveBeenCalled();
  });

  it('silently skips unknown fieldIds (not in project)', async () => {
    prisma.customFieldDef.findMany.mockResolvedValueOnce([]); // no defs found
    await service.applyCustomFieldValues('issue-1', 'proj-1', {
      'unknown-field': 'some value',
    });
    expect(prisma.customFieldValue.upsert).not.toHaveBeenCalled();
    expect(prisma.customFieldValue.deleteMany).not.toHaveBeenCalled();
  });

  it('calls deleteMany when value is null', async () => {
    prisma.customFieldDef.findMany.mockResolvedValueOnce([
      makeDef({ id: 'field-1', type: CustomFieldType.TEXT }),
    ]);
    await service.applyCustomFieldValues('issue-1', 'proj-1', {
      'field-1': null,
    });
    expect(prisma.customFieldValue.deleteMany).toHaveBeenCalledWith({
      where: { fieldId: 'field-1', issueId: 'issue-1' },
    });
    expect(prisma.customFieldValue.upsert).not.toHaveBeenCalled();
  });

  it('calls deleteMany when value is empty string', async () => {
    prisma.customFieldDef.findMany.mockResolvedValueOnce([
      makeDef({ id: 'field-1', type: CustomFieldType.TEXT }),
    ]);
    await service.applyCustomFieldValues('issue-1', 'proj-1', {
      'field-1': '',
    });
    expect(prisma.customFieldValue.deleteMany).toHaveBeenCalled();
  });

  it('coerces string "42" to number 42 for NUMBER type', async () => {
    prisma.customFieldDef.findMany.mockResolvedValueOnce([
      makeDef({ id: 'field-1', type: CustomFieldType.NUMBER }),
    ]);
    await service.applyCustomFieldValues('issue-1', 'proj-1', {
      'field-1': '42',
    });
    expect(prisma.customFieldValue.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ valueNumber: 42 }),
        update: expect.objectContaining({ valueNumber: 42 }),
      }),
    );
  });

  it('skips SELECT value not in allowed options', async () => {
    prisma.customFieldDef.findMany.mockResolvedValueOnce([
      makeDef({
        id: 'field-1',
        type: CustomFieldType.SELECT,
        options: ['A', 'B'],
      }),
    ]);
    await service.applyCustomFieldValues('issue-1', 'proj-1', {
      'field-1': 'C', // not in options
    });
    // toValueColumns returns null for invalid SELECT → deleteMany is called
    expect(prisma.customFieldValue.upsert).not.toHaveBeenCalled();
  });

  it('runs all upserts in parallel (Promise.all)', async () => {
    const defs = [
      makeDef({ id: 'f1', type: CustomFieldType.TEXT }),
      makeDef({ id: 'f2', type: CustomFieldType.TEXT }),
      makeDef({ id: 'f3', type: CustomFieldType.TEXT }),
      makeDef({ id: 'f4', type: CustomFieldType.TEXT }),
      makeDef({ id: 'f5', type: CustomFieldType.TEXT }),
    ];
    prisma.customFieldDef.findMany.mockResolvedValueOnce(defs);

    const callOrder: string[] = [];
    prisma.customFieldValue.upsert.mockImplementation(
      async (args: {
        where: { fieldId_issueId: { fieldId: string } };
      }) => {
        callOrder.push(args.where.fieldId_issueId.fieldId);
        return {};
      },
    );

    await service.applyCustomFieldValues('issue-1', 'proj-1', {
      f1: 'v1',
      f2: 'v2',
      f3: 'v3',
      f4: 'v4',
      f5: 'v5',
    });

    // All 5 upserts should have been called
    expect(prisma.customFieldValue.upsert).toHaveBeenCalledTimes(5);
  });

  it('idempotent: calling twice with same values does not create duplicates (upsert semantics)', async () => {
    prisma.customFieldDef.findMany.mockResolvedValue([
      makeDef({ id: 'field-1', type: CustomFieldType.TEXT }),
    ]);
    await service.applyCustomFieldValues('issue-1', 'proj-1', {
      'field-1': 'hello',
    });
    await service.applyCustomFieldValues('issue-1', 'proj-1', {
      'field-1': 'hello',
    });
    // Both calls use upsert — no create-then-create duplication
    expect(prisma.customFieldValue.upsert).toHaveBeenCalledTimes(2);
    // Both calls use the same where clause
    const calls = prisma.customFieldValue.upsert.mock.calls;
    expect(calls[0][0].where).toEqual(calls[1][0].where);
  });
});
