import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateSavedFilterDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  payload?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  shared?: boolean;
}
