import { ApiPropertyOptional } from '@nestjs/swagger';
import { IssuePriority, IssueType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class UpdateIssueDto {
  @ApiPropertyOptional({ example: 'Updated summary' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  summary?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(50_000)
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
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  assigneeId?: string | null;

  @ApiPropertyOptional({
    example: 'user-uuid',
    description:
      'Reporter (filer) — service enforces LEAD/ADMIN to change this.',
  })
  @IsOptional()
  @IsUUID()
  reporterId?: string;

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

  @ApiPropertyOptional({ description: 'Original time estimate in seconds' })
  @IsInt()
  @Min(0)
  @IsOptional()
  originalEstimate?: number | null;

  @ApiPropertyOptional({ description: 'Remaining time estimate in seconds' })
  @IsInt()
  @Min(0)
  @IsOptional()
  remainingEstimate?: number | null;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  startDate?: string | null;

  @ApiPropertyOptional()
  @IsDateString()
  @IsOptional()
  dueDate?: string | null;

  @ApiPropertyOptional({
    description: 'Map fieldId → value. Type-coerced + validated server-side.',
  })
  @IsObject()
  @IsOptional()
  customFields?: Record<string, unknown>;
}
