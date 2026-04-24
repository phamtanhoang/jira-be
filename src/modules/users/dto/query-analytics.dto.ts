import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class QueryAnalyticsDto {
  @ApiPropertyOptional({
    example: 14,
    minimum: 1,
    maximum: 180,
    description: 'Number of trailing days to bucket (1..180)',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? parseInt(value, 10) : value,
  )
  @IsInt()
  @Min(1)
  @Max(180)
  @IsOptional()
  days?: number;
}
