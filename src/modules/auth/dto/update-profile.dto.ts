import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'John Doe' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    description: 'Public URL for the avatar (use POST /auth/avatar to upload).',
  })
  @IsOptional()
  // Allow null (avatar removal) but require a valid URL otherwise. The
  // FE renders this directly in `<img src>` — `javascript:alert(1)`
  // would otherwise survive to the browser.
  @ValidateIf((_o, v) => v !== null)
  @IsUrl({ require_protocol: true, protocols: ['https', 'http'] })
  @MaxLength(2048)
  image?: string | null;
}
