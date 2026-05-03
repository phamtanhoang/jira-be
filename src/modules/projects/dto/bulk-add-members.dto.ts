import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProjectRole } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsEnum,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class BulkAddProjectMembersDto {
  @ApiProperty({
    type: [String],
    description: 'Workspace member user IDs to add to the project',
    example: ['b3f...', 'c2d...'],
  })
  @IsDefined()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  userIds!: string[];

  @ApiPropertyOptional({ enum: ProjectRole, example: ProjectRole.DEVELOPER })
  @IsEnum(ProjectRole)
  @IsOptional()
  role?: ProjectRole;
}
