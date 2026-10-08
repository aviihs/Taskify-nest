import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { AuthUser } from '../common/types/auth-user';
import { TaskDependenciesService } from './task-dependencies.service';

export class AddDependencyDto {
  @ApiProperty({ description: 'Task that must be finished first' })
  @IsMongoId()
  blockedByTaskId: string;
}

@ApiTags('Task dependencies')
@ApiBearerAuth('JWT-auth')
@Controller('tasks/:taskId/dependencies')
export class TaskDependenciesController {
  constructor(private readonly dependencies: TaskDependenciesService) {}

  @Get()
  @ApiOperation({ summary: 'What blocks this task, and what it blocks' })
  list(
    @CurrentUser() user: AuthUser,
    @Param('taskId', ParseObjectIdPipe) taskId: string,
  ) {
    return this.dependencies.list(user.id, taskId);
  }

  @Post()
  @ApiOperation({ summary: 'Mark this task as blocked by another task' })
  add(
    @CurrentUser() user: AuthUser,
    @Param('taskId', ParseObjectIdPipe) taskId: string,
    @Body() dto: AddDependencyDto,
  ) {
    return this.dependencies.add(user.id, taskId, dto.blockedByTaskId);
  }

  @Delete(':dependencyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a dependency' })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('taskId', ParseObjectIdPipe) taskId: string,
    @Param('dependencyId', ParseObjectIdPipe) dependencyId: string,
  ) {
    return this.dependencies.remove(user.id, taskId, dependencyId);
  }
}
