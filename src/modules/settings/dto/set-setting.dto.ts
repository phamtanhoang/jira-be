import { ApiProperty } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { IsDefined, IsNotEmpty } from 'class-validator';

export class SetSettingDto {
  @ApiProperty({ example: 'Jira Clone', description: 'Any JSON value' })
  @IsDefined()
  @IsNotEmpty()
  value!: Prisma.InputJsonValue;
}
