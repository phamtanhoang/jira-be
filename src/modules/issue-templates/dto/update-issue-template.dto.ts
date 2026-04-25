import { ApiPropertyOptional } from '@nestjs/swagger';
import { IssuePriority, IssueType } from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateIssueTemplateDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional({ enum: IssueType })
  @IsEnum(IssueType)
  @IsOptional()
  type?: IssueType;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  descriptionHtml?: string | null;

  @ApiPropertyOptional({ enum: IssuePriority })
  @IsEnum(IssuePriority)
  @IsOptional()
  defaultPriority?: IssuePriority | null;

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  defaultLabels?: string[];
}
