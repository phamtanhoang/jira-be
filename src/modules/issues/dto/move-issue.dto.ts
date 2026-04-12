import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class MoveIssueDto {
  @ApiProperty({ example: 'column-uuid' })
  @IsString()
  @IsNotEmpty()
  columnId!: string;

  @ApiPropertyOptional({ example: 0, description: 'Position within the column' })
  @IsInt()
  @Min(0)
  @IsOptional()
  position?: number;
}
