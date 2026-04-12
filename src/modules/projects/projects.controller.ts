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
import { ENDPOINTS, MSG } from '@/core/constants';
import { CurrentUser } from '@/core/decorators';
import { AuthUser } from '@/core/types';
import { AddProjectMemberDto, CreateProjectDto, UpdateProjectDto } from './dto';
import { ProjectsService } from './projects.service';

const E = ENDPOINTS.PROJECTS;

@ApiTags('Projects')
@Controller(E.BASE)
export class ProjectsController {
  constructor(private projectsService: ProjectsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new project' })
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateProjectDto) {
    const project = await this.projectsService.create(user.id, dto);
    return { message: MSG.SUCCESS.PROJECT_CREATED, project };
  }

  @Get()
  @ApiOperation({ summary: 'List projects in a workspace' })
  findAll(
    @Query('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.projectsService.findAllByWorkspace(workspaceId, user.id);
  }

  @Get(E.BY_ID)
  @ApiOperation({ summary: 'Get project by ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.projectsService.findById(id, user.id);
  }

  @Patch(E.BY_ID)
  @ApiOperation({ summary: 'Update project (Lead/Admin)' })
  async update(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProjectDto,
  ) {
    const project = await this.projectsService.update(id, user.id, dto);
    return { message: MSG.SUCCESS.PROJECT_UPDATED, project };
  }

  @Delete(E.BY_ID)
  @ApiOperation({ summary: 'Delete project (Lead only)' })
  async delete(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.projectsService.delete(id, user.id);
    return { message: MSG.SUCCESS.PROJECT_DELETED };
  }

  // ─── Members ──────────────────────────────────────────

  @Post(`${E.BY_ID}/${E.MEMBERS}`)
  @ApiOperation({ summary: 'Add member to project (Lead/Admin)' })
  async addMember(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: AddProjectMemberDto,
  ) {
    const member = await this.projectsService.addMember(id, user.id, dto);
    return { message: MSG.SUCCESS.MEMBER_ADDED, member };
  }

  @Delete(`${E.BY_ID}/${E.MEMBER_BY_ID}`)
  @ApiOperation({ summary: 'Remove member from project (Lead/Admin)' })
  async removeMember(
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.projectsService.removeMember(id, memberId, user.id);
    return { message: MSG.SUCCESS.MEMBER_REMOVED };
  }
}
