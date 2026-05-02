import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IssuePriority, IssueType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsDefined,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateIssueDto {
  @ApiProperty({ example: 'project-uuid' })
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @ApiProperty({ example: 'Implement login page' })
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  summary!: string;

  @ApiPropertyOptional({ example: 'Detailed description...' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ enum: IssueType, example: IssueType.TASK })
  @IsEnum(IssueType)
  @IsOptional()
  type?: IssueType;

  @ApiPropertyOptional({ enum: IssuePriority, example: IssuePriority.MEDIUM })
  @IsEnum(IssuePriority)
  @IsOptional()
  priority?: IssuePriority;

  @ApiPropertyOptional({ example: 'user-uuid' })
  @IsString()
  @IsOptional()
  assigneeId?: string;

  @ApiPropertyOptional({
    example: 'parent-issue-uuid',
    description: 'For subtasks',
  })
  @IsString()
  @IsOptional()
  parentId?: string;

  @ApiPropertyOptional({ example: 'epic-issue-uuid' })
  @IsString()
  @IsOptional()
  epicId?: string;

  @ApiPropertyOptional({ example: 'sprint-uuid' })
  @IsString()
  @IsOptional()
  sprintId?: string;

  @ApiPropertyOptional({ example: 3 })
  @IsInt()
  @Min(0)
  @IsOptional()
  storyPoints?: number;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  dueDate?: string;

  @ApiPropertyOptional({
    description: 'Map fieldId → value. Type-coerced + validated server-side.',
  })
  @IsObject()
  @IsOptional()
  customFields?: Record<string, unknown>;
}
