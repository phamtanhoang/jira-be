import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateSprintDto {
  @ApiProperty({ example: 'board-uuid' })
  @IsString()
  @IsNotEmpty()
  boardId!: string;

  @ApiProperty({ example: 'Sprint 1' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ example: 'Complete user stories for auth' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  goal?: string;

  @ApiPropertyOptional({ example: '2026-04-15T00:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-04-29T00:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  endDate?: string;
}
