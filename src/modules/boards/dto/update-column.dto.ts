import { ApiPropertyOptional } from '@nestjs/swagger';
import { StatusCategory } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateColumnDto {
  @ApiPropertyOptional({ example: 'Testing' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ enum: StatusCategory })
  @IsEnum(StatusCategory)
  @IsOptional()
  category?: StatusCategory;

  @ApiPropertyOptional({ example: 5 })
  @IsInt()
  @Min(1)
  @IsOptional()
  wipLimit?: number | null;
}
