import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryAnalyticsDto } from '@/modules/users/dto/query-analytics.dto';

function toDto(payload: Record<string, unknown>) {
  return plainToInstance(QueryAnalyticsDto, payload);
}

describe('QueryAnalyticsDto', () => {
  it('accepts empty payload (sinceHours is optional)', async () => {
    expect(await validate(toDto({}))).toHaveLength(0);
  });

  it.each([1, 24, 24 * 7, 24 * 14, 24 * 30, 24 * 90, 24 * 365])(
    'accepts sinceHours=%i',
    async (sinceHours) => {
      expect(await validate(toDto({ sinceHours }))).toHaveLength(0);
    },
  );

  it('coerces sinceHours from string', async () => {
    const dto = toDto({ sinceHours: '336' });
    expect(dto.sinceHours).toBe(336);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects sinceHours < 1', async () => {
    const errors = await validate(toDto({ sinceHours: 0 }));
    expect(errors.some((e) => e.property === 'sinceHours')).toBe(true);
  });

  it('has no upper bound — admin endpoint, FE drives the UX cap', async () => {
    // 5 years' worth of hours should still pass; effective ceiling is the
    // RequestLog retention cron, not the DTO.
    expect(await validate(toDto({ sinceHours: 24 * 365 * 5 }))).toHaveLength(0);
  });
});
