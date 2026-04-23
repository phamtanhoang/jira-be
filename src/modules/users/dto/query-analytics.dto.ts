import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';

export class QueryAnalyticsDto {
  @ApiPropertyOptional({ example: 14, enum: [7, 14, 30] })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? parseInt(value, 10) : value,
  )
  @IsInt()
  @IsIn([7, 14, 30])
  @IsOptional()
  days?: number;
}
