import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProjectType, Visibility } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsDefined,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateProjectDto {
  @ApiProperty({ example: 'My Project' })
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'PROJ', description: 'Uppercase 2-5 chars' })
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z]{2,5}$/, { message: 'Key must be 2-5 uppercase letters' })
  key!: string;

  @ApiProperty({ example: 'workspace-uuid' })
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  workspaceId!: string;

  @ApiPropertyOptional({ example: 'Project description' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ enum: ProjectType, example: ProjectType.SCRUM })
  @IsEnum(ProjectType)
  @IsOptional()
  type?: ProjectType;

  @ApiPropertyOptional({ enum: Visibility, example: Visibility.PRIVATE })
  @IsEnum(Visibility)
  @IsOptional()
  visibility?: Visibility;
}
