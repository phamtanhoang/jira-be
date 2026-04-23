import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryMetricsDto } from '@/modules/users/dto/query-metrics.dto';

function toDto(payload: Record<string, unknown>) {
  return plainToInstance(QueryMetricsDto, payload);
}

describe('QueryMetricsDto', () => {
  it('accepts empty payload', async () => {
    expect(await validate(toDto({}))).toHaveLength(0);
  });

  it('accepts sinceHours=24', async () => {
    expect(await validate(toDto({ sinceHours: 24 }))).toHaveLength(0);
  });

  it('coerces sinceHours from string', async () => {
    const dto = toDto({ sinceHours: '48' });
    expect(dto.sinceHours).toBe(48);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects sinceHours < 1', async () => {
    const errors = await validate(toDto({ sinceHours: 0 }));
    expect(errors.some((e) => e.property === 'sinceHours')).toBe(true);
  });

  it('rejects sinceHours > 168', async () => {
    const errors = await validate(toDto({ sinceHours: 200 }));
    expect(errors.some((e) => e.property === 'sinceHours')).toBe(true);
  });
});
