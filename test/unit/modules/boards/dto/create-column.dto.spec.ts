import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { StatusCategory } from '@prisma/client';
import { CreateColumnDto } from '@/modules/boards/dto/create-column.dto';

function toDto(payload: Record<string, unknown>) {
  return plainToInstance(CreateColumnDto, payload);
}

describe('CreateColumnDto', () => {
  it('accepts name only (category + wipLimit are optional)', async () => {
    expect(await validate(toDto({ name: 'In Review' }))).toHaveLength(0);
  });

  it('accepts valid category + wipLimit', async () => {
    expect(
      await validate(
        toDto({
          name: 'In Progress',
          category: StatusCategory.IN_PROGRESS,
          wipLimit: 5,
        }),
      ),
    ).toHaveLength(0);
  });

  it('rejects empty name', async () => {
    const errors = await validate(toDto({ name: '' }));
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('rejects name longer than 50 chars', async () => {
    const errors = await validate(toDto({ name: 'x'.repeat(51) }));
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('rejects invalid category enum', async () => {
    const errors = await validate(
      toDto({ name: 'X', category: 'NOT_A_CATEGORY' }),
    );
    expect(errors.some((e) => e.property === 'category')).toBe(true);
  });

  it('rejects wipLimit < 1', async () => {
    const errors = await validate(toDto({ name: 'X', wipLimit: 0 }));
    expect(errors.some((e) => e.property === 'wipLimit')).toBe(true);
  });

  it('rejects non-integer wipLimit', async () => {
    const errors = await validate(toDto({ name: 'X', wipLimit: 2.5 }));
    expect(errors.some((e) => e.property === 'wipLimit')).toBe(true);
  });
});
