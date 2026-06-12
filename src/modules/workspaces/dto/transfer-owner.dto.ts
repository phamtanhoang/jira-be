import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class TransferWorkspaceOwnerDto {
  @ApiProperty({
    description:
      'UUID of the workspace member who will become the new OWNER. ' +
      'Must already be a member of this workspace.',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsDefined()
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  newOwnerId!: string;
}
