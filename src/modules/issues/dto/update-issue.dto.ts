import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { IssuePriority, IssueType } from '@prisma/client';

export class UpdateIssueDto {
  @ApiPropertyOptional({ example: 'Updated summary' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  summary?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ enum: IssueType })
  @IsEnum(IssueType)
  @IsOptional()
  type?: IssueType;

  @ApiPropertyOptional({ enum: IssuePriority })
  @IsEnum(IssuePriority)
  @IsOptional()
  priority?: IssuePriority;

  @ApiPropertyOptional({ example: 'user-uuid' })
  @IsString()
  @IsOptional()
  assigneeId?: string | null;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  sprintId?: string | null;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  epicId?: string | null;

  @ApiPropertyOptional()
  @IsInt()
  @Min(0)
  @IsOptional()
  storyPoints?: number | null;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  dueDate?: string | null;
}
