import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { REGEX } from '@/core/constants';

export class LoginDto {
  @ApiProperty({ example: 'john@example.com' })
  @IsString()
  @IsNotEmpty()
  @Matches(REGEX.EMAIL)
  email!: string;

  @ApiProperty({ example: 'Pass@123' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
