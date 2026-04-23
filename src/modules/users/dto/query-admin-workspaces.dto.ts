import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class QueryAdminWorkspacesDto {
  @ApiPropertyOptional({ example: 'acme' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ example: 'uuid' })
  @IsString()
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({ example: 50, minimum: 1, maximum: 200 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? parseInt(value, 10) : value,
  )
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  take?: number;
}
