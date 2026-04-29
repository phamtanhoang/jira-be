import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class BulkInviteDto {
  @ApiProperty({ type: [String], example: ['a@example.com', 'b@example.com'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsEmail({}, { each: true })
  emails!: string[];

  @ApiPropertyOptional({
    description: 'Optional custom message included in the invitation email',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}
