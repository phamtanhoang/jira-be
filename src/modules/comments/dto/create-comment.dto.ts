import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateCommentDto {
  @ApiProperty({ example: 'This is a comment' })
  @IsString()
  @IsNotEmpty()
  content!: string;

  @ApiPropertyOptional({
    example: 'parent-comment-uuid',
    description: 'For threaded replies',
  })
  @IsString()
  @IsOptional()
  parentId?: string;
}
