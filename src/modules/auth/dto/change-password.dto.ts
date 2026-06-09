import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { REGEX } from '@/core/constants';

export class ChangePasswordDto {
  /**
   * Required for users that already have a password (verify identity).
   * Omitted by OAuth-only users setting a password for the first time —
   * BE detects that case via `user.password == null` and skips the check.
   */
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  currentPassword?: string;

  @ApiProperty({ example: 'Pass@123' })
  @IsString()
  @IsNotEmpty()
  @Matches(REGEX.PASSWORD)
  newPassword!: string;
}
