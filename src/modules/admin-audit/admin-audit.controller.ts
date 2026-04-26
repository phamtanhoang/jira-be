import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { ENDPOINTS } from '@/core/constants';
import { Roles } from '@/core/decorators';
import { AdminAuditService } from './admin-audit.service';
import { QueryAuditDto } from './dto';

const E = ENDPOINTS.ADMIN;

@ApiTags('Admin')
@Roles(Role.ADMIN)
@Controller(E.BASE)
export class AdminAuditController {
  constructor(private adminAuditService: AdminAuditService) {}

  @Get(E.AUDIT)
  @ApiOperation({ summary: 'List admin audit log entries' })
  findAll(@Query() query: QueryAuditDto) {
    return this.adminAuditService.findAll(query);
  }

  @Get(E.AUDIT_EXPORT)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="audit-log.csv"')
  @ApiOperation({
    summary:
      'Export the (filtered) audit log as CSV. Accepts the same query as the list endpoint.',
  })
  exportCsv(@Query() query: QueryAuditDto) {
    return this.adminAuditService.exportCsv(query);
  }
}
