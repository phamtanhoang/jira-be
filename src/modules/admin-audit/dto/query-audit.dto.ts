import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

const ACTIONS = [
  'ROLE_CHANGE',
  'USER_DELETE',
  'USER_DEACTIVATE',
  'USER_ACTIVATE',
  'SESSION_REVOKE',
  'SESSIONS_REVOKE_ALL',
  'WORKSPACE_DELETE',
  'PROJECT_DELETE',
  'ATTACHMENT_DELETE',
  'AVATAR_UPDATE',
  'SETTING_UPDATE',
  'FLAG_CREATE',
  'FLAG_UPDATE',
  'FLAG_DELETE',
] as const;

export class QueryAuditDto {
  @ApiPropertyOptional({ enum: ACTIONS })
  @IsString()
  @IsIn([...ACTIONS])
  @IsOptional()
  action?: (typeof ACTIONS)[number];

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  actorId?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  targetType?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? parseInt(value, 10) : value,
  )
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ example: 50, minimum: 1, maximum: 200 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? parseInt(value, 10) : value,
  )
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  take?: number;
}
