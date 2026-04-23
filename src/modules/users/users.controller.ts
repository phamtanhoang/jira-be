import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { ENDPOINTS } from '@/core/constants';
import { CurrentUser, Roles } from '@/core/decorators';
import type { AuthUser } from '@/core/types';
import { QueryUsersDto, UpdateRoleDto } from './dto';
import { UsersService } from './users.service';

const E = ENDPOINTS.USERS;

@ApiTags('Users')
@Roles(Role.ADMIN)
@Controller(E.BASE)
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List users with filters (Admin only)' })
  findAll(@Query() query: QueryUsersDto) {
    return this.usersService.findAll(query);
  }

  @Patch(E.ROLE)
  @ApiOperation({ summary: 'Update a user role (Admin only)' })
  updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.usersService.updateRole(id, dto.role, user.id);
  }

  @Delete(E.BY_ID)
  @ApiOperation({ summary: 'Delete a user (Admin only)' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.usersService.remove(id, user.id);
  }

  @Get(E.SESSIONS)
  @ApiOperation({
    summary: 'List active refresh-token sessions for a user (Admin only)',
  })
  listSessions(@Param('id') id: string) {
    return this.usersService.listSessions(id);
  }

  @Delete(E.SESSION_BY_ID)
  @ApiOperation({ summary: 'Revoke a single session (Admin only)' })
  revokeSession(@Param('id') id: string, @Param('tokenId') tokenId: string) {
    return this.usersService.revokeSession(id, tokenId);
  }

  @Delete(E.SESSIONS)
  @ApiOperation({ summary: 'Revoke ALL sessions for a user (Admin only)' })
  revokeAllSessions(@Param('id') id: string) {
    return this.usersService.revokeAllSessions(id);
  }
}
