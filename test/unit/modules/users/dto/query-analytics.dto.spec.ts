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

  it.each([7, 14, 30])('accepts days=%i', async (days) => {
    expect(await validate(toDto({ days }))).toHaveLength(0);
  });

  it('coerces days from string', async () => {
    const dto = toDto({ days: '14' });
    expect(dto.days).toBe(14);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects days outside the whitelist', async () => {
    for (const days of [1, 10, 60, 365]) {
      const errors = await validate(toDto({ days }));
      expect(errors.some((e) => e.property === 'days')).toBe(true);
    }
  });
});
