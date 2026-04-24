import { ApiProperty } from '@nestjs/swagger';
import { ProjectRole } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateProjectMemberDto {
  @ApiProperty({ enum: ProjectRole, example: ProjectRole.DEVELOPER })
  @IsEnum(ProjectRole)
  role!: ProjectRole;
}
