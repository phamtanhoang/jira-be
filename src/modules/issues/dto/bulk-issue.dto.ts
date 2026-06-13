import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IssuePriority } from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsDefined,
  IsOptional,
  IsUUID,
  ArrayMaxSize,
  ArrayMinSize,
} from 'class-validator';

// 200 is generous for any reasonable UI bulk-select workflow (whole
// page selections are ~50 rows). Without an upper bound a caller could
// pass 100k ids and trigger a massive `findMany` + `updateMany`.
const BULK_ISSUE_MAX = 200;

export class BulkUpdateIssueDto {
  @ApiProperty({ example: ['uuid-1', 'uuid-2'] })
  @IsDefined()
  @IsArray()
  @IsUUID('all', { each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_ISSUE_MAX)
  issueIds!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sprintId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assigneeId?: string | null;

  @ApiPropertyOptional({ enum: IssuePriority })
  @IsEnum(IssuePriority)
  @IsOptional()
  priority?: IssuePriority;
}

export class BulkDeleteIssueDto {
  @ApiProperty({ example: ['uuid-1', 'uuid-2'] })
  @IsDefined()
  @IsArray()
  @IsUUID('all', { each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_ISSUE_MAX)
  issueIds!: string[];
}
