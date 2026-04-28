import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

export class QueryAnalyticsDto {
  // Trailing window in hours — matches the metrics endpoint's contract.
  // Service rounds up to whole days for the daily-bucket aggregation.
  // No upper cap: admin-only endpoint, effective ceiling is RequestLog
  // retention (`LOG_RETENTION_EXPIRY`).
  @ApiPropertyOptional({
    example: 24 * 14,
    minimum: 1,
    description: 'Trailing window in hours.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? parseInt(value, 10) : value,
  )
  @IsInt()
  @Min(1)
  @IsOptional()
  sinceHours?: number;
}
