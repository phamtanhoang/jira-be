import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProjectRole } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { REGEX } from '@/core/constants';

export class AddProjectMemberDto {
  @ApiProperty({ example: 'john@example.com' })
  @IsString()
  @IsNotEmpty()
  @Matches(REGEX.EMAIL)
  email!: string;

  @ApiPropertyOptional({ enum: ProjectRole, example: ProjectRole.DEVELOPER })
  @IsEnum(ProjectRole)
  @IsOptional()
  role?: ProjectRole;
}
