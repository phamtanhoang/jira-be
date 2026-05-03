import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDefined,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateLabelDto {
  @ApiProperty({ example: 'project-uuid' })
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @ApiProperty({ example: 'bug' })
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name!: string;

  @ApiPropertyOptional({ example: '#e74c3c' })
  @IsString()
  @IsOptional()
  color?: string;
}
