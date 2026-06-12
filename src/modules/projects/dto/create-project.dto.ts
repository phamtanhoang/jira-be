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

  @ApiPropertyOptional({
    example: 'PROJ',
    description:
      'Optional. When omitted, the BE derives a key from the project name ' +
      '(e.g. "Mobile Web" → "MW") and auto-suffixes on collision. Accepts ' +
      'uppercase letters + digits, 2-10 chars.',
  })
  @IsString()
  @IsOptional()
  @Matches(/^[A-Z][A-Z0-9]{1,9}$/, {
    message: 'Key must start with a letter and use uppercase letters + digits',
  })
  key?: string;

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
