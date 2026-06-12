import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsDefined,
  MaxLength,
} from 'class-validator';

export class CreateCommentDto {
  @ApiProperty({ example: 'This is a comment' })
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  // Cap at 10 KB — comments are Tiptap HTML and a single comment past
  // this size starts to feel like a document, not a comment. Stops the
  // DoS vector of someone pasting a megabyte of HTML.
  @MaxLength(10_000)
  content!: string;

  @ApiPropertyOptional({
    example: 'parent-comment-uuid',
    description: 'For threaded replies',
  })
  @IsString()
  @IsOptional()
  parentId?: string;
}
