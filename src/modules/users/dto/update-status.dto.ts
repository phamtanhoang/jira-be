import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsDefined } from 'class-validator';

export class UpdateStatusDto {
  @ApiProperty({ example: false })
  @IsDefined()
  @IsBoolean()
  active!: boolean;
}
