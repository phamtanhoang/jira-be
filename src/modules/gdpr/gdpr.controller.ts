import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ENDPOINTS } from '@/core/constants';
import { CurrentUser } from '@/core/decorators';
import type { AuthUser } from '@/core/types';
import { GdprService } from './gdpr.service';

const E = ENDPOINTS.AUTH;

@ApiTags('Auth/GDPR')
@Controller(E.BASE)
export class GdprController {
  constructor(private service: GdprService) {}

  @Get(E.DATA_EXPORT)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Header('Content-Type', 'application/json; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="user-data.json"')
  @ApiOperation({
    summary: 'Download all data attached to the current user as JSON (GDPR)',
  })
  async exportData(@CurrentUser() user: AuthUser, @Res() res: Response) {
    const data = await this.service.exportMyData(user.id);
    res.json(data);
  }

  @Get(E.DELETION_REQUEST)
  @ApiOperation({ summary: 'Current account deletion status (if requested)' })
  status(@CurrentUser() user: AuthUser) {
    return this.service.getMyDeletionStatus(user.id);
  }

  @Post(E.DELETION_REQUEST)
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark the account for deletion. 30-day grace period applies.',
  })
  request(@CurrentUser() user: AuthUser) {
    return this.service.requestDeletion(user.id);
  }

  @Delete(E.DELETION_REQUEST)
  @ApiOperation({ summary: 'Cancel a pending deletion request' })
  cancel(@CurrentUser() user: AuthUser) {
    return this.service.cancelDeletion(user.id);
  }
}
