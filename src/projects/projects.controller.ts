import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { AuthUser } from '../common/types/auth-user';
import {
  AddProjectMemberDto,
  CreateProjectDto,
  ListProjectsQueryDto,
  UpdateProjectDto,
} from './dtos/project.dto';
import { ProjectMembersService } from './project-members.service';
import { ProjectsService } from './projects.service';

@ApiTags('Projects')
@ApiBearerAuth('JWT-auth')
@Controller()
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly members: ProjectMembersService,
  ) {}

  @Get('workspaces/:workspaceId/projects')
  @ApiOperation({
    summary: 'List projects I can see in a workspace (with progress)',
  })
  list(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId', ParseObjectIdPipe) workspaceId: string,
    @Query() query: ListProjectsQueryDto,
  ) {
    return this.projects.list(user.id, workspaceId, query);
  }

  @Post('workspaces/:workspaceId/projects')
  @ApiOperation({ summary: 'Create a project' })
  create(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId', ParseObjectIdPipe) workspaceId: string,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projects.create(user.id, workspaceId, dto);
  }

  @Get('projects/:projectId')
  @ApiOperation({ summary: 'Get a project (with progress)' })
  get(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseObjectIdPipe) projectId: string,
  ) {
    return this.projects.get(user.id, projectId);
  }

  @Patch('projects/:projectId')
  @ApiOperation({ summary: 'Update a project' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projects.update(user.id, projectId, dto);
  }

  @Delete('projects/:projectId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a project' })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseObjectIdPipe) projectId: string,
  ) {
    return this.projects.remove(user.id, projectId);
  }

  @Get('projects/:projectId/members')
  @ApiOperation({ summary: 'List project members' })
  listMembers(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseObjectIdPipe) projectId: string,
  ) {
    return this.members.list(user.id, projectId);
  }

  @Post('projects/:projectId/members')
  @ApiOperation({ summary: 'Add a workspace member to the project' })
  addMember(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Body() dto: AddProjectMemberDto,
  ) {
    return this.members.add(user.id, projectId, dto.userId);
  }

  @Delete('projects/:projectId/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a project member, or leave when userId is yourself',
  })
  removeMember(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Param('userId', ParseObjectIdPipe) userId: string,
  ) {
    return this.members.remove(user.id, projectId, userId);
  }
}
