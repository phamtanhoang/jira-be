import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { Role } from '@prisma/client';
import { UpdateRoleDto } from '@/modules/users/dto/update-role.dto';

describe('UpdateRoleDto', () => {
  it('accepts role=ADMIN', async () => {
    const dto = plainToInstance(UpdateRoleDto, { role: Role.ADMIN });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts role=USER', async () => {
    const dto = plainToInstance(UpdateRoleDto, { role: Role.USER });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects unknown role', async () => {
    const dto = plainToInstance(UpdateRoleDto, { role: 'SUPERADMIN' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'role')).toBe(true);
  });

  it('rejects missing role', async () => {
    const dto = plainToInstance(UpdateRoleDto, {});
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'role')).toBe(true);
  });
});
