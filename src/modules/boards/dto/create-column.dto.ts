import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StatusCategory } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateColumnDto {
  @ApiProperty({ example: 'In Review' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name!: string;

  @ApiPropertyOptional({
    enum: StatusCategory,
    example: StatusCategory.IN_PROGRESS,
  })
  @IsEnum(StatusCategory)
  @IsOptional()
  category?: StatusCategory;

  @ApiPropertyOptional({ example: 5, description: 'WIP limit for Kanban' })
  @IsInt()
  @Min(1)
  @IsOptional()
  wipLimit?: number;
}
