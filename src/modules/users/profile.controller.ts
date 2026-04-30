import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/core/decorators';
import type { AuthUser } from '@/core/types';
import { UsersService } from './users.service';

/**
 * User profile view for any authenticated viewer (not just admins). Sits
 * on its own controller so it doesn't inherit the class-level
 * `@Roles(Role.ADMIN)` from `UsersController`.
 *
 * Privacy gate lives in the service: viewer + target must share a workspace
 * or the endpoint 404s (no role-based disclosure of existence).
 */
@ApiTags('Users')
@Controller('users')
export class UserProfileController {
  constructor(private usersService: UsersService) {}

  @Get(':id/profile')
  @ApiOperation({ summary: 'Public-ish profile view (any auth user)' })
  getProfile(@Param('id') id: string, @CurrentUser() viewer: AuthUser) {
    return this.usersService.getProfile(id, viewer.id);
  }
}
