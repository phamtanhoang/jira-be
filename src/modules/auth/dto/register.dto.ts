import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { REGEX } from '@/core/constants';

export class RegisterDto {
  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'john@example.com' })
  @IsString()
  @IsNotEmpty()
  // RFC 5321 max email length is 254. Without an upper bound, multi-MB
  // emails would slip through to bcrypt + the unique-index probe.
  @MaxLength(254)
  @Matches(REGEX.EMAIL)
  email!: string;

  @ApiProperty({ example: 'Pass@123' })
  @IsString()
  @IsNotEmpty()
  // Bcrypt silently truncates inputs past 72 bytes — "Hunter72" and
  // "Hunter72Plus" would hash identically without this cap.
  @MaxLength(72)
  @Matches(REGEX.PASSWORD)
  password!: string;
}
