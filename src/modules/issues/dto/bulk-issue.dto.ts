import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  ArrayMinSize,
} from 'class-validator';
import { IssuePriority } from '@prisma/client';

export class BulkUpdateIssueDto {
  @ApiProperty({ example: ['uuid-1', 'uuid-2'] })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  issueIds: string[];

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  sprintId?: string | null;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  assigneeId?: string | null;

  @ApiPropertyOptional({ enum: IssuePriority })
  @IsEnum(IssuePriority)
  @IsOptional()
  priority?: IssuePriority;
}

export class BulkDeleteIssueDto {
  @ApiProperty({ example: ['uuid-1', 'uuid-2'] })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  issueIds: string[];
}
