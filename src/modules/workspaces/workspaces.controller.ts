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
import { ENDPOINTS, MSG } from '@/core/constants';
import { CurrentUser } from '@/core/decorators';
import { AuthUser } from '@/core/types';
import {
  AddWorkspaceMemberDto,
  CreateWorkspaceDto,
  UpdateWorkspaceDto,
  UpdateWorkspaceMemberDto,
} from './dto';
import { WorkspacesService } from './workspaces.service';

const E = ENDPOINTS.WORKSPACES;

@ApiTags('Workspaces')
@Controller(E.BASE)
export class WorkspacesController {
  constructor(private workspacesService: WorkspacesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new workspace' })
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateWorkspaceDto) {
    const workspace = await this.workspacesService.create(user.id, dto);
    return { message: MSG.SUCCESS.WORKSPACE_CREATED, workspace };
  }

  @Get()
  @ApiOperation({ summary: 'List workspaces for current user' })
  findAll(@CurrentUser() user: AuthUser) {
    return this.workspacesService.findAllByUser(user.id);
  }

  @Get(E.BY_ID)
  @ApiOperation({ summary: 'Get workspace by ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.workspacesService.findById(id, user.id);
  }

  @Patch(E.BY_ID)
  @ApiOperation({ summary: 'Update workspace (Owner/Admin)' })
  async update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    const workspace = await this.workspacesService.update(id, user.id, dto);
    return { message: MSG.SUCCESS.WORKSPACE_UPDATED, workspace };
  }

  @Delete(E.BY_ID)
  @ApiOperation({ summary: 'Delete workspace (Owner only)' })
  async delete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.workspacesService.delete(id, user.id);
    return { message: MSG.SUCCESS.WORKSPACE_DELETED };
  }

  // ─── Members ──────────────────────────────────────────

  @Post(`${E.BY_ID}/${E.MEMBERS}`)
  @ApiOperation({ summary: 'Add member to workspace (Owner/Admin)' })
  async addMember(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: AddWorkspaceMemberDto,
  ) {
    const member = await this.workspacesService.addMember(id, user.id, dto);
    return { message: MSG.SUCCESS.MEMBER_ADDED, member };
  }

  @Patch(`${E.BY_ID}/${E.MEMBER_BY_ID}`)
  @ApiOperation({ summary: 'Update member role (Owner/Admin)' })
  async updateMember(
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateWorkspaceMemberDto,
  ) {
    const member = await this.workspacesService.updateMember(
      id,
      memberId,
      user.id,
      dto,
    );
    return { message: MSG.SUCCESS.MEMBER_UPDATED, member };
  }

  @Delete(`${E.BY_ID}/${E.MEMBER_BY_ID}`)
  @ApiOperation({ summary: 'Remove member from workspace (Owner/Admin)' })
  async removeMember(
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.workspacesService.removeMember(id, memberId, user.id);
    return { message: MSG.SUCCESS.MEMBER_REMOVED };
  }
}
