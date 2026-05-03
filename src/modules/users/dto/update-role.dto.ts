import { ApiProperty } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsDefined, IsEnum } from 'class-validator';

export class UpdateRoleDto {
  @ApiProperty({ enum: Role, example: Role.ADMIN })
  @IsDefined()
  @IsEnum(Role)
  role!: Role;
}
