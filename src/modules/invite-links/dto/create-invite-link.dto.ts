import { ApiPropertyOptional } from '@nestjs/swagger';
import { WorkspaceRole } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';

export class CreateInviteLinkDto {
  @ApiPropertyOptional({
    enum: WorkspaceRole,
    default: 'MEMBER',
    description:
      'Role assigned to users joining via this link. Cannot be OWNER.',
  })
  @IsEnum(WorkspaceRole)
  @IsOptional()
  role?: WorkspaceRole;

  @ApiPropertyOptional({
    description: 'Hard cap on uses. Omit / null = unlimited until revoked.',
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  maxUses?: number;

  @ApiPropertyOptional({
    description:
      'Expiry in seconds from now. Omit / null = never expires until revoked.',
  })
  @IsInt()
  @Min(60)
  @IsOptional()
  expiresInSec?: number;
}
