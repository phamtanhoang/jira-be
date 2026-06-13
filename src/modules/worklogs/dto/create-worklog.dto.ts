import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsDefined,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// One week in seconds — beyond this the entry is almost certainly a
// fat-fingered millisecond value or hostile input. Burndown + velocity
// math both assume time-per-entry stays within a sane range.
const SECONDS_PER_WEEK = 7 * 24 * 3600;

export class CreateWorklogDto {
  @ApiProperty({ example: 3600, description: 'Time spent in seconds' })
  @IsDefined()
  @IsInt()
  @Min(1)
  @Max(SECONDS_PER_WEEK)
  timeSpent!: number;

  @ApiProperty({ example: '2026-04-08T09:00:00.000Z' })
  @IsDefined()
  @IsDateString()
  @IsNotEmpty()
  startedAt!: string;

  @ApiPropertyOptional({ example: 'Worked on login page' })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  description?: string;
}
