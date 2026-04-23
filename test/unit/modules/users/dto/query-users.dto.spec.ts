import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { Role } from '@prisma/client';
import { QueryUsersDto } from '@/modules/users/dto/query-users.dto';

function toDto(payload: Record<string, unknown>) {
  return plainToInstance(QueryUsersDto, payload);
}

describe('QueryUsersDto', () => {
  it('accepts empty payload (all optional)', async () => {
    expect(await validate(toDto({}))).toHaveLength(0);
  });

  it('accepts valid filters', async () => {
    expect(
      await validate(
        toDto({
          search: 'apollo',
          role: Role.ADMIN,
          verified: true,
          take: 50,
        }),
      ),
    ).toHaveLength(0);
  });

  it('coerces verified="true" string to boolean', async () => {
    const dto = toDto({ verified: 'true' });
    expect(dto.verified).toBe(true);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('coerces take from string to number', async () => {
    const dto = toDto({ take: '25' });
    expect(dto.take).toBe(25);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects invalid role enum', async () => {
    const errors = await validate(toDto({ role: 'SUPERADMIN' }));
    expect(errors.some((e) => e.property === 'role')).toBe(true);
  });

  it('rejects take > 200', async () => {
    const errors = await validate(toDto({ take: 500 }));
    expect(errors.some((e) => e.property === 'take')).toBe(true);
  });

  it('rejects take < 1', async () => {
    const errors = await validate(toDto({ take: 0 }));
    expect(errors.some((e) => e.property === 'take')).toBe(true);
  });
});
