import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  ForgotPasswordDto,
  ResetPasswordDto,
} from '@/modules/auth/dto/forgot-password.dto';

describe('ForgotPasswordDto', () => {
  it('accepts a valid email', async () => {
    const dto = plainToInstance(ForgotPasswordDto, { email: 'a@b.co' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects invalid email', async () => {
    const dto = plainToInstance(ForgotPasswordDto, { email: 'bad' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('rejects empty payload', async () => {
    const dto = plainToInstance(ForgotPasswordDto, {});
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });
});

describe('ResetPasswordDto', () => {
  const valid = {
    email: 'a@b.co',
    token: '123456',
    newPassword: 'NewPass@1',
  };

  it('accepts valid payload', async () => {
    const dto = plainToInstance(ResetPasswordDto, valid);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects weak newPassword', async () => {
    const dto = plainToInstance(ResetPasswordDto, {
      ...valid,
      newPassword: 'weak',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'newPassword')).toBe(true);
  });

  it('rejects when token is missing', async () => {
    const dto = plainToInstance(ResetPasswordDto, { ...valid, token: '' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'token')).toBe(true);
  });

  it('rejects when email is malformed', async () => {
    const dto = plainToInstance(ResetPasswordDto, { ...valid, email: 'bad' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });
});
