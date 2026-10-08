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
  CreateWorkspaceDto,
  ListMembersQueryDto,
  UpdateMemberDto,
  UpdateWorkspaceDto,
} from './dtos/workspace.dto';
import { WorkspaceMembersService } from './workspace-members.service';
import { WorkspacesService } from './workspaces.service';

@ApiTags('Workspaces')
@ApiBearerAuth('JWT-auth')
@Controller('workspaces')
export class WorkspacesController {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly members: WorkspaceMembersService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List my workspaces (personal first) with my role in each',
  })
  list(@CurrentUser() user: AuthUser) {
    return this.workspaces.listForUser(user.id);
  }

  @Post()
  @ApiOperation({
    summary: 'Create an organization workspace (you become OWNER)',
  })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateWorkspaceDto) {
    return this.workspaces.createOrganization(user.id, dto);
  }

  @Get(':workspaceId')
  @ApiOperation({ summary: 'Get a workspace with my role and permissions' })
  get(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId', ParseObjectIdPipe) workspaceId: string,
  ) {
    return this.workspaces.get(user.id, workspaceId);
  }

  @Patch(':workspaceId')
  @ApiOperation({ summary: 'Update workspace details' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId', ParseObjectIdPipe) workspaceId: string,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    return this.workspaces.update(user.id, workspaceId, dto);
  }

  @Delete(':workspaceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an organization workspace (owner only)' })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId', ParseObjectIdPipe) workspaceId: string,
  ) {
    return this.workspaces.remove(user.id, workspaceId);
  }

  @Get(':workspaceId/members')
  @ApiOperation({ summary: 'List workspace members' })
  listMembers(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId', ParseObjectIdPipe) workspaceId: string,
    @Query() query: ListMembersQueryDto,
  ) {
    return this.members.list(user.id, workspaceId, query);
  }

  @Patch(':workspaceId/members/:userId')
  @ApiOperation({ summary: "Change a member's role, title or status" })
  updateMember(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId', ParseObjectIdPipe) workspaceId: string,
    @Param('userId', ParseObjectIdPipe) userId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.members.update(user.id, workspaceId, userId, dto);
  }

  @Delete(':workspaceId/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a member, or leave the workspace when userId is yourself',
  })
  removeMember(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId', ParseObjectIdPipe) workspaceId: string,
    @Param('userId', ParseObjectIdPipe) userId: string,
  ) {
    return this.members.remove(user.id, workspaceId, userId);
  }
}
