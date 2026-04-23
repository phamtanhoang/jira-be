import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@/core/decorators';

/**
 * Debug endpoints — REMOVE after verifying Sentry + logging work in prod.
 */
@ApiTags('Debug')
@Controller()
export class DebugController {
  @Public()
  @Get('debug-sentry')
  @ApiOperation({ summary: 'Throws a test error to verify Sentry capture' })
  getError() {
    throw new Error('My first Sentry error!');
  }
}
