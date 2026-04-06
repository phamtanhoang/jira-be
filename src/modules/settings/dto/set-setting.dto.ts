import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class SetSettingDto {
  @ApiProperty({ example: 'app_name' })
  @IsString()
  @IsNotEmpty()
  key!: string;

  @ApiProperty({ example: 'Jira Clone', description: 'Any JSON value' })
  @IsNotEmpty()
  value!: any;
}
