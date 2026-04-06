import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MinLength } from 'class-validator';
import { REGEX } from '../../../core/constants/validation.constant.js';

export class RegisterDto {
  @ApiProperty({ example: 'John Doe' })
  @IsString()
  name!: string;

  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Pass@123' })
  @IsString()
  @MinLength(8)
  @Matches(REGEX.PASSWORD)
  password!: string;
}
