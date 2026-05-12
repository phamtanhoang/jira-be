import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateLabelDto {
  @ApiPropertyOptional({ example: 'bug' })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ example: '#e74c3c' })
  @IsString()
  @IsOptional()
  color?: string;
}
