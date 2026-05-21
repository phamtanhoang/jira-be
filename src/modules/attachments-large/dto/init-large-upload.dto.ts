import {
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class InitLargeUploadDto {
  @IsUUID()
  issueId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(127)
  mimeType!: string;

  @IsInt()
  @Min(1)
  fileSize!: number;

  @IsInt()
  @Min(1)
  totalChunks!: number;
}
