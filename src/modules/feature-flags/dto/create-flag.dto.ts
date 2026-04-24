import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class FlagConditions {
  @ApiPropertyOptional({ enum: Role, isArray: true })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  roles?: Role[];

  @ApiPropertyOptional({ example: ['alice@example.com'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  emails?: string[];

  @ApiPropertyOptional({ example: ['workspace-uuid-1'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  workspaceIds?: string[];
}

export class CreateFlagDto {
  @ApiProperty({ example: 'beta_boards' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/^[a-z0-9._]+$/, {
    message: 'key must be lowercase letters, numbers, dots or underscores',
  })
  key!: string;

  @ApiProperty({ example: 'Beta boards' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @ApiPropertyOptional({ example: 0, minimum: 0, maximum: 100 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? parseInt(value, 10) : value,
  )
  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  rolloutPercentage?: number;

  @ApiPropertyOptional({ type: FlagConditions })
  @IsObject()
  @ValidateNested()
  @IsOptional()
  conditions?: FlagConditions;
}
