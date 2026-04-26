import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ENDPOINTS, MSG } from '@/core/constants';
import { CurrentUser, Public } from '@/core/decorators';
import { AuthUser } from '@/core/types';
import { CreateInviteLinkDto } from './dto';
import { InviteLinksService } from './invite-links.service';

const E = ENDPOINTS.WORKSPACES;

@ApiTags('Workspace Invite Links')
@Controller(E.BASE)
export class InviteLinksController {
  constructor(private service: InviteLinksService) {}

  @Get(E.INVITE_LINKS)
  @ApiOperation({ summary: 'List invite links for a workspace' })
  list(@Param('id') workspaceId: string, @CurrentUser() user: AuthUser) {
    return this.service.list(workspaceId, user.id).then((links) => ({ links }));
  }

  @Post(E.INVITE_LINKS)
  @ApiOperation({ summary: 'Create an invite link (admin/owner only)' })
  async create(
    @Param('id') workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateInviteLinkDto,
  ) {
    const link = await this.service.create(workspaceId, user.id, dto);
    return { message: MSG.SUCCESS.INVITE_LINK_CREATED, link };
  }

  @Delete(E.INVITE_LINK_BY_ID)
  @ApiOperation({ summary: 'Revoke an invite link' })
  async revoke(
    @Param('id') workspaceId: string,
    @Param('linkId') linkId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.service.revoke(workspaceId, linkId, user.id);
    return { message: MSG.SUCCESS.INVITE_LINK_REVOKED };
  }

  @Public()
  @Get(E.INVITE_PREVIEW)
  @ApiOperation({
    summary:
      'Preview an invite link (workspace + role) — no auth so the join page can render before sign-in',
  })
  preview(@Param('token') token: string) {
    return this.service.preview(token);
  }

  @Post(E.JOIN)
  @ApiOperation({ summary: 'Join the workspace via invite token' })
  async join(@Param('token') token: string, @CurrentUser() user: AuthUser) {
    const result = await this.service.join(token, user.id);
    return { message: MSG.SUCCESS.INVITE_JOINED, ...result };
  }
}
