/**
 * DTO validation tests for LoginDto — covers class-validator decorators.
 */
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { LoginDto } from '@/modules/auth/dto/login.dto';

function toDto(payload: Record<string, unknown>) {
  return plainToInstance(LoginDto, payload);
}

describe('LoginDto', () => {
  it('accepts valid email + password', async () => {
    const errors = await validate(
      toDto({ email: 'a@b.co', password: 'anything' }),
    );
    expect(errors).toHaveLength(0);
  });

  it('rejects missing email', async () => {
    const errors = await validate(toDto({ email: '', password: 'x' }));
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('rejects invalid email format', async () => {
    const errors = await validate(
      toDto({ email: 'not-an-email', password: 'x' }),
    );
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('rejects missing password', async () => {
    const errors = await validate(toDto({ email: 'a@b.co', password: '' }));
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });

  it('rejects non-string email', async () => {
    const errors = await validate(toDto({ email: 123, password: 'x' }));
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });
});
