import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { ENDPOINTS } from '@/core/constants';
import { Roles } from '@/core/decorators';
import { AdminService } from './admin.service';

const E = ENDPOINTS.ADMIN;

@ApiTags('Admin')
@Roles(Role.ADMIN)
@Controller(E.BASE)
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Get(E.STATS)
  @ApiOperation({ summary: 'System-wide counts for the admin overview' })
  getStats() {
    return this.adminService.getStats();
  }
}
