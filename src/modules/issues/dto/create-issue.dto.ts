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
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateIssueDto {
  @ApiProperty({ example: 'project-uuid' })
  @IsDefined()
  @IsUUID()
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
  // Cap at 50 KB — Tiptap HTML can be verbose but legitimate content
  // shouldn't approach this. Without a cap, a single request can pin a
  // worker for seconds serialising / sanitising the HTML.
  @MaxLength(50_000)
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
  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @ApiPropertyOptional({
    example: 'parent-issue-uuid',
    description: 'For subtasks',
  })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({ example: 'epic-issue-uuid' })
  @IsOptional()
  @IsUUID()
  epicId?: string;

  @ApiPropertyOptional({ example: 'sprint-uuid' })
  @IsOptional()
  @IsUUID()
  sprintId?: string;

  @ApiPropertyOptional({ example: 3 })
  @IsInt()
  @Min(0)
  // Cap at 1000 — burndown + velocity math break catastrophically when
  // a single issue carries millions of points.
  @Max(1000)
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
