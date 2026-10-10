import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/pagination/pagination';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { AuthUser } from '../common/types/auth-user';
import { ActivityService } from './activity.service';

@ApiTags('Activity')
@ApiBearerAuth('JWT-auth')
@Controller()
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get('workspaces/:workspaceId/activity')
  @ApiOperation({ summary: 'Workspace activity feed' })
  forWorkspace(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId', ParseObjectIdPipe) workspaceId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.activity.forWorkspace(user.id, workspaceId, query);
  }

  @Get('projects/:projectId/activity')
  @ApiOperation({ summary: 'Project activity feed' })
  forProject(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.activity.forProject(user.id, projectId, query);
  }

  @Get('tasks/:taskId/activity')
  @ApiOperation({
    summary: 'Task history (status, assignees, due date changes, …)',
  })
  forTask(
    @CurrentUser() user: AuthUser,
    @Param('taskId', ParseObjectIdPipe) taskId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.activity.forTask(user.id, taskId, query);
  }
}
