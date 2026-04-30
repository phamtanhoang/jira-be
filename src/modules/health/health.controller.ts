import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '@/core/decorators';
import { AdminService } from '@/modules/users/admin.service';

/**
 * Public health endpoint for external uptime monitors (Better Stack,
 * UptimeRobot, etc.). Returns minimal info — no secrets, no runtime
 * details, no admin data — just enough to determine "is the service up?".
 *
 * The richer `/admin/health` endpoint (admin-only) reports configuration
 * + latencies + Sentry/Mail wiring status.
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private adminService: AdminService) {}

  @Public()
  @SkipThrottle()
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Public health probe (no auth, no throttle)',
    description:
      'Returns 200 with status=ok|degraded|down. Use for uptime monitoring.',
  })
  check() {
    return this.adminService.getPublicHealth();
  }
}
