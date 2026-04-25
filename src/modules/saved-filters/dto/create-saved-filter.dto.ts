import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateSavedFilterDto {
  @ApiProperty()
  @IsString()
  projectId!: string;

  @ApiProperty({ example: 'My open bugs' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiProperty({ description: 'JSON-serializable filter payload' })
  @IsObject()
  payload!: Record<string, unknown>;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  shared?: boolean;
}
