import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';
import { Prisma } from '@prisma/client';

export class SetSettingDto {
  @ApiProperty({ example: 'Jira Clone', description: 'Any JSON value' })
  @IsNotEmpty()
  value!: Prisma.InputJsonValue;
}
