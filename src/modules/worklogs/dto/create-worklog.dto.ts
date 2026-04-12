import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class CreateWorklogDto {
  @ApiProperty({ example: 3600, description: 'Time spent in seconds' })
  @IsInt()
  @Min(1)
  timeSpent!: number;

  @ApiProperty({ example: '2026-04-08T09:00:00.000Z' })
  @IsDateString()
  @IsNotEmpty()
  startedAt!: string;

  @ApiPropertyOptional({ example: 'Worked on login page' })
  @IsString()
  @IsOptional()
  description?: string;
}
