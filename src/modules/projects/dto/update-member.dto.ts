import { ApiProperty } from '@nestjs/swagger';
import { ProjectRole } from '@prisma/client';
import { IsDefined, IsEnum } from 'class-validator';

export class UpdateProjectMemberDto {
  @ApiProperty({ enum: ProjectRole, example: ProjectRole.DEVELOPER })
  @IsDefined()
  @IsEnum(ProjectRole)
  role!: ProjectRole;
}
