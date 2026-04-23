import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LogLevel } from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateClientLogDto {
  @ApiProperty({ enum: LogLevel })
  @IsEnum(LogLevel)
  level!: LogLevel;

  @ApiProperty()
  @IsString()
  url!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  method?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  statusCode?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  errorMessage?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  errorStack?: string;

  @ApiPropertyOptional({
    description: 'Array of breadcrumb events leading up to the error',
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  breadcrumbs?: unknown[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  requestBody?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  responseBody?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userAgent?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sentryEventId?: string;
}
