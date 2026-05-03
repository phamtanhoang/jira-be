import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IssuePriority, IssueType, RecurringFrequency } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDefined,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class RecurringTemplateDto {
  @ApiProperty({ example: 'Weekly status report' })
  @IsDefined()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  summary!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: IssueType })
  @IsOptional()
  @IsEnum(IssueType)
  type?: IssueType;

  @ApiPropertyOptional({ enum: IssuePriority })
  @IsOptional()
  @IsEnum(IssuePriority)
  priority?: IssuePriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  labelIds?: string[];
}

export class CreateRecurringRuleDto {
  @ApiProperty({ format: 'uuid' })
  @IsDefined()
  @IsUUID()
  projectId!: string;

  @ApiProperty()
  @IsDefined()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiProperty({ enum: RecurringFrequency })
  @IsDefined()
  @IsEnum(RecurringFrequency)
  frequency!: RecurringFrequency;

  @ApiPropertyOptional({ minimum: 0, maximum: 23, example: 9 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  hour?: number;

  @ApiProperty({ type: RecurringTemplateDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => RecurringTemplateDto)
  template!: RecurringTemplateDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateRecurringRuleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ enum: RecurringFrequency })
  @IsOptional()
  @IsEnum(RecurringFrequency)
  frequency?: RecurringFrequency;

  @ApiPropertyOptional({ minimum: 0, maximum: 23 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(23)
  hour?: number;

  @ApiPropertyOptional({ type: RecurringTemplateDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RecurringTemplateDto)
  template?: RecurringTemplateDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
