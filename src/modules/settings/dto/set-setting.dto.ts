import { ApiProperty } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { IsNotEmpty } from 'class-validator';

export class SetSettingDto {
  @ApiProperty({ example: 'Jira Clone', description: 'Any JSON value' })
  @IsNotEmpty()
  value!: Prisma.InputJsonValue;
}
