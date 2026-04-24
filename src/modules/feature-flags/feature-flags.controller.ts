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
import { PrismaService } from '@/core/database/prisma.service';
import { CurrentUser, Roles } from '@/core/decorators';
import type { AuthUser } from '@/core/types';
import { CreateFlagDto, UpdateFlagDto } from './dto';
import { FeatureFlagsService } from './feature-flags.service';

const E = ENDPOINTS.FEATURE_FLAGS;

@ApiTags('Feature Flags')
@Controller(E.BASE)
export class FeatureFlagsController {
  constructor(
    private featureFlagsService: FeatureFlagsService,
    private prisma: PrismaService,
  ) {}

  /**
   * Authenticated (but not admin-only) — any logged-in user can fetch their
   * own evaluated flags. Used by the FE `useFeatureFlag` hook.
   */
  @Get(E.ME)
  @ApiOperation({ summary: 'Get the current user evaluated feature flags' })
  async getMyFlags(@CurrentUser() user: AuthUser) {
    const fullUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: {
        workspaceMembers: { select: { workspaceId: true } },
      },
    });
    if (!fullUser) return {};
    return this.featureFlagsService.evaluateForUser(fullUser);
  }

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'List all feature flags (Admin only)' })
  list() {
    return this.featureFlagsService.list();
  }

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create a feature flag (Admin only)' })
  create(@Body() dto: CreateFlagDto, @CurrentUser() user: AuthUser) {
    return this.featureFlagsService.create(dto, user.id);
  }

  @Patch(E.BY_ID)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update a feature flag (Admin only)' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateFlagDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.featureFlagsService.update(id, dto, user.id);
  }

  @Delete(E.BY_ID)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Delete a feature flag (Admin only)' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.featureFlagsService.remove(id, user.id);
  }
}
