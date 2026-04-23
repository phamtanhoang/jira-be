import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class QueryMetricsDto {
  @ApiPropertyOptional({ example: 24, minimum: 1, maximum: 168 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? parseInt(value, 10) : value,
  )
  @IsInt()
  @Min(1)
  @Max(168)
  @IsOptional()
  sinceHours?: number;
}
