import { ApiProperty } from '@nestjs/swagger';
import { IssueLinkType } from '@prisma/client';
import { IsEnum, IsString, IsUUID } from 'class-validator';

export class CreateIssueLinkDto {
  @ApiProperty()
  @IsString()
  @IsUUID()
  targetIssueId!: string;

  @ApiProperty({ enum: IssueLinkType })
  @IsEnum(IssueLinkType)
  type!: IssueLinkType;
}
