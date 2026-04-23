import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { VerifyEmailDto } from '@/modules/auth/dto/verify-email.dto';

function toDto(payload: Record<string, unknown>) {
  return plainToInstance(VerifyEmailDto, payload);
}

describe('VerifyEmailDto', () => {
  it('accepts valid email + 6-char token', async () => {
    expect(
      await validate(toDto({ email: 'a@b.co', token: '123456' })),
    ).toHaveLength(0);
  });

  it('rejects token shorter than 6', async () => {
    const errors = await validate(toDto({ email: 'a@b.co', token: '12345' }));
    expect(errors.some((e) => e.property === 'token')).toBe(true);
  });

  it('rejects token longer than 6', async () => {
    const errors = await validate(toDto({ email: 'a@b.co', token: '1234567' }));
    expect(errors.some((e) => e.property === 'token')).toBe(true);
  });

  it('rejects missing token', async () => {
    const errors = await validate(toDto({ email: 'a@b.co', token: '' }));
    expect(errors.some((e) => e.property === 'token')).toBe(true);
  });

  it('rejects invalid email', async () => {
    const errors = await validate(toDto({ email: 'bad', token: '123456' }));
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });
});
