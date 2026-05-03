import { ApiProperty } from '@nestjs/swagger';
import { WorkspaceRole } from '@prisma/client';
import { IsDefined, IsEnum } from 'class-validator';

export class UpdateWorkspaceMemberDto {
  @ApiProperty({ enum: WorkspaceRole, example: WorkspaceRole.ADMIN })
  @IsDefined()
  @IsEnum(WorkspaceRole)
  role!: WorkspaceRole;
}
