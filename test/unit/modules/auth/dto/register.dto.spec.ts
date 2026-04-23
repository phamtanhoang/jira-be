import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from '@/modules/auth/dto/register.dto';

function toDto(payload: Record<string, unknown>) {
  return plainToInstance(RegisterDto, payload);
}

describe('RegisterDto', () => {
  const valid = { name: 'John', email: 'a@b.co', password: 'Pass@123' };

  it('accepts a fully valid payload', async () => {
    expect(await validate(toDto(valid))).toHaveLength(0);
  });

  it('rejects empty name', async () => {
    const errors = await validate(toDto({ ...valid, name: '' }));
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('rejects weak password (no special char)', async () => {
    const errors = await validate(toDto({ ...valid, password: 'Password1' }));
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });

  it('rejects weak password (no digit)', async () => {
    const errors = await validate(toDto({ ...valid, password: 'Password@' }));
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });

  it('rejects weak password (too short)', async () => {
    const errors = await validate(toDto({ ...valid, password: 'Aa1@' }));
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });

  it('rejects invalid email format', async () => {
    const errors = await validate(toDto({ ...valid, email: 'bad' }));
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });
});
