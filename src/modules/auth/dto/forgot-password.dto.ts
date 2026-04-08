import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { REGEX } from '@/core/constants';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'john@example.com' })
  @IsString()
  @IsNotEmpty()
  @Matches(REGEX.EMAIL)
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: 'john@example.com' })
  @IsString()
  @IsNotEmpty()
  @Matches(REGEX.EMAIL)
  email!: string;

  @ApiProperty({ example: '123456', description: '6-digit OTP code' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ example: 'NewPass@123' })
  @IsString()
  @IsNotEmpty()
  @Matches(REGEX.PASSWORD)
  newPassword!: string;
}
