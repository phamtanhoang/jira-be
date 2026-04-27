import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString } from 'class-validator';

export class SubscribePushDto {
  @ApiProperty({
    description:
      'Web Push API subscription object — pass result of `pushManager.subscribe()` directly.',
  })
  @IsObject()
  subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  userAgent?: string;
}

export class UnsubscribePushDto {
  @ApiProperty()
  @IsString()
  endpoint: string;
}
