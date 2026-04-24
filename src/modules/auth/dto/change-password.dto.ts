import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { REGEX } from '@/core/constants';

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @ApiProperty({ example: 'Pass@123' })
  @IsString()
  @IsNotEmpty()
  @Matches(REGEX.PASSWORD)
  newPassword!: string;
}
