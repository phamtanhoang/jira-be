import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ReorderColumnsDto } from '@/modules/boards/dto/reorder-columns.dto';

function toDto(payload: Record<string, unknown>) {
  return plainToInstance(ReorderColumnsDto, payload);
}

describe('ReorderColumnsDto', () => {
  it('accepts an array of string ids', async () => {
    const errors = await validate(toDto({ columnIds: ['a', 'b', 'c'] }));
    expect(errors).toHaveLength(0);
  });

  it('accepts an empty array (no validators forbid it at DTO layer)', async () => {
    const errors = await validate(toDto({ columnIds: [] }));
    expect(errors).toHaveLength(0);
  });

  it('rejects a non-array value', async () => {
    const errors = await validate(toDto({ columnIds: 'not-an-array' }));
    expect(errors.some((e) => e.property === 'columnIds')).toBe(true);
  });

  it('rejects an array containing non-strings', async () => {
    const errors = await validate(toDto({ columnIds: ['a', 42, 'c'] }));
    expect(errors.some((e) => e.property === 'columnIds')).toBe(true);
  });
});
