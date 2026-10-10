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
  CreateTaskDto,
  ListTasksQueryDto,
  MyTasksQueryDto,
  UpdateTaskDto,
} from './dtos/task.dto';
import { MyTasksService } from './my-tasks.service';
import { TasksService } from './tasks.service';

@ApiTags('Tasks')
@ApiBearerAuth('JWT-auth')
@Controller()
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly myTasks: MyTasksService,
  ) {}

  @Get('users/me/tasks')
  @ApiOperation({
    summary: 'My Tasks: tasks assigned to me across all my workspaces',
  })
  listMine(@CurrentUser() user: AuthUser, @Query() query: MyTasksQueryDto) {
    return this.myTasks.list(user.id, query);
  }

  @Get('projects/:projectId/tasks')
  @ApiOperation({ summary: 'List, filter and sort tasks in a project' })
  list(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Query() query: ListTasksQueryDto,
  ) {
    return this.tasks.list(user.id, projectId, query);
  }

  @Post('projects/:projectId/tasks')
  @ApiOperation({ summary: 'Create a task (or a subtask with parentTaskId)' })
  create(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Body() dto: CreateTaskDto,
  ) {
    return this.tasks.create(user.id, projectId, dto);
  }

  @Get('tasks/:taskId')
  @ApiOperation({
    summary: 'Get a task with assignees, labels and subtask progress',
  })
  get(
    @CurrentUser() user: AuthUser,
    @Param('taskId', ParseObjectIdPipe) taskId: string,
  ) {
    return this.tasks.get(user.id, taskId);
  }

  @Patch('tasks/:taskId')
  @ApiOperation({
    summary: 'Update a task (status, priority, assignees, labels, dates, …)',
  })
  update(
    @CurrentUser() user: AuthUser,
    @Param('taskId', ParseObjectIdPipe) taskId: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasks.update(user.id, taskId, dto);
  }

  @Delete('tasks/:taskId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a task and its subtasks' })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('taskId', ParseObjectIdPipe) taskId: string,
  ) {
    return this.tasks.remove(user.id, taskId);
  }

  @Get('tasks/:taskId/subtasks')
  @ApiOperation({ summary: 'List subtasks' })
  listSubtasks(
    @CurrentUser() user: AuthUser,
    @Param('taskId', ParseObjectIdPipe) taskId: string,
  ) {
    return this.tasks.listSubtasks(user.id, taskId);
  }
}
