import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { StatusCategory } from '@prisma/client';
import { UpdateColumnDto } from '@/modules/boards/dto/update-column.dto';

function toDto(payload: Record<string, unknown>) {
  return plainToInstance(UpdateColumnDto, payload);
}

describe('UpdateColumnDto', () => {
  it('accepts an empty payload (all optional)', async () => {
    expect(await validate(toDto({}))).toHaveLength(0);
  });

  it('accepts partial updates', async () => {
    expect(await validate(toDto({ name: 'Testing' }))).toHaveLength(0);
    expect(await validate(toDto({ wipLimit: 3 }))).toHaveLength(0);
    expect(
      await validate(toDto({ category: StatusCategory.DONE })),
    ).toHaveLength(0);
  });

  it('rejects name longer than 50', async () => {
    const errors = await validate(toDto({ name: 'x'.repeat(51) }));
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('rejects invalid category', async () => {
    const errors = await validate(toDto({ category: 'FAKE' }));
    expect(errors.some((e) => e.property === 'category')).toBe(true);
  });

  it('rejects wipLimit < 1', async () => {
    const errors = await validate(toDto({ wipLimit: 0 }));
    expect(errors.some((e) => e.property === 'wipLimit')).toBe(true);
  });
});
