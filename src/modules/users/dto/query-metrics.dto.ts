import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class QueryMetricsDto {
  // No upper cap — admin-only endpoint, FE RangePicker drives the UX
  // bound. Effective ceiling is RequestLog retention (rows older than
  // `LOG_RETENTION_EXPIRY` are pruned by the cleanup cron anyway).
  @ApiPropertyOptional({ example: 24, minimum: 1 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? parseInt(value, 10) : value,
  )
  @IsInt()
  @Min(1)
  @IsOptional()
  sinceHours?: number;

  @ApiPropertyOptional({
    example: 30,
    minimum: 1,
    maximum: 200,
    description:
      'Default page size for the long lists (slowest/recent). Used as a fallback when the per-list params below are omitted.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? parseInt(value, 10) : value,
  )
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  take?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 200,
    description: 'Per-list LIMIT for the topRoutes table.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? parseInt(value, 10) : value,
  )
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  topRoutesTake?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 200,
    description: 'Per-list LIMIT for the slowestRequests table.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? parseInt(value, 10) : value,
  )
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  slowestTake?: number;
}
