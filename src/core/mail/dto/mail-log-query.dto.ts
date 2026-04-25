import { ApiPropertyOptional } from '@nestjs/swagger';
import { MailStatus, MailType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class MailLogQueryDto {
  @ApiPropertyOptional({ enum: MailStatus })
  @IsEnum(MailStatus)
  @IsOptional()
  status?: MailStatus;

  @ApiPropertyOptional({ enum: MailType })
  @IsEnum(MailType)
  @IsOptional()
  type?: MailType;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  recipient?: string;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page: number = 1;

  @ApiPropertyOptional({ default: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  pageSize: number = 50;
}

export class MailTestDto {
  @ApiPropertyOptional({ description: 'Recipient address for the test email' })
  @IsString()
  to!: string;
}
