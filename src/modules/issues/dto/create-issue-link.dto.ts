import { ApiProperty } from '@nestjs/swagger';
import { IssueLinkType } from '@prisma/client';
import { IsDefined, IsEnum, IsString, IsUUID } from 'class-validator';

export class CreateIssueLinkDto {
  @ApiProperty()
  @IsDefined()
  @IsString()
  @IsUUID()
  targetIssueId!: string;

  @ApiProperty({ enum: IssueLinkType })
  @IsDefined()
  @IsEnum(IssueLinkType)
  type!: IssueLinkType;
}
