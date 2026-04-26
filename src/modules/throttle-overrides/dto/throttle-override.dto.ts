import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const TARGET_PATTERN = /^(user:[\w-]+|ip:[\d.:a-fA-F]+)$/;

export class CreateThrottleOverrideDto {
  @ApiProperty({
    example: 'user:11111111-1111-1111-1111-111111111111',
    description:
      'Target tracker key — `user:UUID` for an authenticated user, `ip:ADDR` for an anonymous IP',
  })
  @IsString()
  @Matches(TARGET_PATTERN, {
    message: 'target must match `user:UUID` or `ip:ADDR`',
  })
  target: string;

  @ApiPropertyOptional({
    description:
      'When true, the guard skips throttling entirely for this target',
  })
  @IsOptional()
  @IsBoolean()
  bypass?: boolean;

  @ApiPropertyOptional({
    description: 'Multiplier applied to the route limit when bypass is false',
    minimum: 0.1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(100)
  multiplier?: number;

  @ApiPropertyOptional({ description: 'Free-text reason for audit' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;

  @ApiPropertyOptional({
    description: 'ISO timestamp after which the row is ignored',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class UpdateThrottleOverrideDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  bypass?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(100)
  multiplier?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;
}
