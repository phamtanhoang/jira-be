import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ENDPOINTS } from '@/core/constants';
import { CurrentUser } from '@/core/decorators';
import type { AuthUser } from '@/core/types';
import { CreatePatDto } from './dto';
import { PatService } from './pat.service';

const E = ENDPOINTS.AUTH;

@ApiTags('Auth/PAT')
@Controller(`${E.BASE}/${E.TOKENS}`)
export class PatController {
  constructor(private service: PatService) {}

  @Get()
  @ApiOperation({ summary: 'List my personal access tokens (no raw values)' })
  list(@CurrentUser() user: AuthUser) {
    return this.service.list(user.id);
  }

  @Post()
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    summary:
      'Create a new PAT. Raw token returned ONCE — UI must surface it immediately.',
  })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePatDto) {
    return this.service.create(user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Revoke a PAT by id' })
  revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.revoke(user.id, id);
  }
}
