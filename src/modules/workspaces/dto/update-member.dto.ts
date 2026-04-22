import { ApiProperty } from '@nestjs/swagger';
import { WorkspaceRole } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateWorkspaceMemberDto {
  @ApiProperty({ enum: WorkspaceRole, example: WorkspaceRole.ADMIN })
  @IsEnum(WorkspaceRole)
  role!: WorkspaceRole;
}
