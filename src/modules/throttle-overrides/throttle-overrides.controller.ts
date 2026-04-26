import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { ENDPOINTS } from '@/core/constants';
import { CurrentUser, Roles } from '@/core/decorators';
import type { AuthUser } from '@/core/types';
import { CreateThrottleOverrideDto, UpdateThrottleOverrideDto } from './dto';
import { ThrottleOverridesService } from './throttle-overrides.service';

const E = ENDPOINTS.ADMIN;

@ApiTags('Admin/ThrottleOverrides')
@Roles(Role.ADMIN)
@Controller(E.BASE)
export class ThrottleOverridesController {
  constructor(private service: ThrottleOverridesService) {}

  @Get(E.THROTTLE_OVERRIDES)
  @ApiOperation({ summary: 'List all throttle overrides (active + expired)' })
  list() {
    return this.service.list();
  }

  @Post(E.THROTTLE_OVERRIDES)
  @ApiOperation({ summary: 'Create a new throttle override for a target' })
  create(
    @Body() dto: CreateThrottleOverrideDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.service.create(actor.id, dto);
  }

  @Patch(E.THROTTLE_OVERRIDE_BY_ID)
  @ApiOperation({ summary: 'Update bypass/multiplier/reason/expiresAt' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateThrottleOverrideDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.service.update(actor.id, id, dto);
  }

  @Delete(E.THROTTLE_OVERRIDE_BY_ID)
  @ApiOperation({ summary: 'Remove an override entirely' })
  remove(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.service.delete(actor.id, id);
  }
}
