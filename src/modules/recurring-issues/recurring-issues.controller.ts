import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/core/decorators';
import type { AuthUser } from '@/core/types';
import { CreateRecurringRuleDto, UpdateRecurringRuleDto } from './dto';
import { RecurringIssuesService } from './recurring-issues.service';

@ApiTags('RecurringIssues')
@Controller('recurring-issues')
export class RecurringIssuesController {
  constructor(private service: RecurringIssuesService) {}

  @Get()
  @ApiOperation({ summary: 'List recurring rules for a project' })
  list(@Query('projectId') projectId: string, @CurrentUser() user: AuthUser) {
    return this.service.list(projectId, user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a recurring rule (admin/lead)' })
  create(@Body() dto: CreateRecurringRuleDto, @CurrentUser() user: AuthUser) {
    return this.service.create(user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update name/frequency/template/enabled' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRecurringRuleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a recurring rule (does not affect spawned issues)',
  })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.delete(id, user.id);
  }
}
