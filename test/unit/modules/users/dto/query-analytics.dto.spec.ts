import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryAnalyticsDto } from '@/modules/users/dto/query-analytics.dto';

function toDto(payload: Record<string, unknown>) {
  return plainToInstance(QueryAnalyticsDto, payload);
}

describe('QueryAnalyticsDto', () => {
  it('accepts empty payload (days is optional)', async () => {
    expect(await validate(toDto({}))).toHaveLength(0);
  });

  it.each([1, 7, 14, 30, 45, 90, 180])('accepts days=%i', async (days) => {
    expect(await validate(toDto({ days }))).toHaveLength(0);
  });

  it('coerces days from string', async () => {
    const dto = toDto({ days: '14' });
    expect(dto.days).toBe(14);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects days < 1', async () => {
    const errors = await validate(toDto({ days: 0 }));
    expect(errors.some((e) => e.property === 'days')).toBe(true);
  });

  it('rejects days > 180', async () => {
    const errors = await validate(toDto({ days: 365 }));
    expect(errors.some((e) => e.property === 'days')).toBe(true);
  });
});
