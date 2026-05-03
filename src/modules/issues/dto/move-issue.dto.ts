import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDefined, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

export class MoveIssueDto {
  @ApiProperty({ example: 'column-uuid' })
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  columnId!: string;

  @ApiPropertyOptional({
    example: 0,
    description: 'Position within the column',
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  position?: number;
}
