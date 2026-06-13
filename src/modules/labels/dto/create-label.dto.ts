import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDefined,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateLabelDto {
  @ApiProperty({ example: 'project-uuid' })
  @IsDefined()
  @IsUUID()
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
  // Strict 6-digit hex — the FE renders this directly into inline
  // styles / SVG `fill` attributes. Without a regex an attacker could
  // store `red; background:url(javascript:...)` and slip past the
  // outer sanitizer when the value ends up in a non-Tiptap context.
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'color must be a 6-digit hex' })
  color?: string;
}
