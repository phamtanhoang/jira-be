import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ENDPOINTS } from '@/core/constants';
import { Public } from '@/core/decorators';
import { IssuesService } from '@/modules/issues/issues.service';

const E = ENDPOINTS.PUBLIC;

/**
 * Routes that intentionally bypass auth — exposed via @Public(). Each must
 * stand on its own without leaking workspace data; the IssuesService method
 * called below already strips emails / worklogs / private fields before
 * returning.
 *
 * Throttled hard because anyone with the token can hit it: a leaked URL
 * shouldn't let an attacker use the token to crawl the whole table.
 */
@ApiTags('Public')
@Controller(E.BASE)
export class PublicController {
  constructor(private issuesService: IssuesService) {}

  @Public()
  @Get(E.ISSUE_BY_TOKEN)
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @ApiOperation({ summary: 'Read an issue via its share token (no auth)' })
  async findIssue(@Param('token') token: string) {
    const issue = await this.issuesService.findByShareToken(token);
    return { issue };
  }
}
