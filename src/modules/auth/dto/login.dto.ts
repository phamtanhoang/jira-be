import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { REGEX } from '@/core/constants';

export class LoginDto {
  @ApiProperty({ example: 'john@example.com' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  @Matches(REGEX.EMAIL)
  email!: string;

  @ApiProperty({ example: 'Pass@123' })
  @IsString()
  @IsNotEmpty()
  // Bcrypt truncates at 72 bytes — cap matches register.
  @MaxLength(72)
  password!: string;
}
