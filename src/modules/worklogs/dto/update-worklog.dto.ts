import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdateWorklogDto {
  @ApiPropertyOptional({ example: 7200 })
  @IsInt()
  @Min(1)
  @IsOptional()
  timeSpent?: number;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  startedAt?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;
}
