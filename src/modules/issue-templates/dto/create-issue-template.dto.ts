import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IssuePriority, IssueType } from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateIssueTemplateDto {
  @ApiProperty()
  @IsString()
  projectId!: string;

  @ApiProperty({ example: 'Bug template' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ enum: IssueType, default: 'TASK' })
  @IsEnum(IssueType)
  @IsOptional()
  type?: IssueType;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  descriptionHtml?: string;

  @ApiPropertyOptional({ enum: IssuePriority })
  @IsEnum(IssuePriority)
  @IsOptional()
  defaultPriority?: IssuePriority;

  @ApiPropertyOptional({ type: [String], description: 'Label IDs' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  defaultLabels?: string[];
}
