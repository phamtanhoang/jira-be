import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

export class ReorderColumnsDto {
  @ApiProperty({
    example: ['col-uuid-1', 'col-uuid-2', 'col-uuid-3'],
    description: 'Column IDs in new order',
  })
  @IsArray()
  @IsString({ each: true })
  columnIds!: string[];
}
