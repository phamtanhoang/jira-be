import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public, CurrentUser } from '@/core/decorators';
import type { AuthUser } from '@/core/types';
import { SubscribePushDto, UnsubscribePushDto } from './dto';
import { PushService } from './push.service';

@ApiTags('Push')
@Controller('push')
export class PushController {
  constructor(private service: PushService) {}

  @Public()
  @Get('config')
  @ApiOperation({
    summary:
      'Returns VAPID public key + enabled flag for the FE to wire up subscribe()',
  })
  config() {
    return {
      enabled: this.service.isEnabled(),
      publicKey: this.service.publicKey(),
    };
  }

  @Post('subscribe')
  @ApiOperation({
    summary: 'Persist a Web Push subscription for the current user',
  })
  subscribe(@Body() dto: SubscribePushDto, @CurrentUser() user: AuthUser) {
    return this.service.subscribe(user.id, dto.subscription, dto.userAgent);
  }

  @Delete('subscribe')
  @ApiOperation({ summary: 'Remove a subscription for the current user' })
  unsubscribe(@Body() dto: UnsubscribePushDto, @CurrentUser() user: AuthUser) {
    return this.service.unsubscribe(user.id, dto.endpoint);
  }
}
