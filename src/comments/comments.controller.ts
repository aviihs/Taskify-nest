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
import { PaginationQueryDto } from '../common/pagination/pagination';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { AuthUser } from '../common/types/auth-user';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dtos/create-comment.dto';
import { UpdateCommentDto } from './dtos/update-comment.dto';

@ApiTags('Comments')
@ApiBearerAuth('JWT-auth')
@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get('tasks/:taskId/comments')
  @ApiOperation({ summary: 'List task comments (threads with replies)' })
  list(
    @CurrentUser() user: AuthUser,
    @Param('taskId', ParseObjectIdPipe) taskId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.comments.list(user.id, taskId, query);
  }

  @Post('tasks/:taskId/comments')
  @ApiOperation({
    summary: 'Comment on a task (supports @mentions and replies)',
  })
  create(
    @CurrentUser() user: AuthUser,
    @Param('taskId', ParseObjectIdPipe) taskId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.comments.create(user.id, taskId, dto);
  }

  @Patch('comments/:commentId')
  @ApiOperation({ summary: 'Edit a comment' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('commentId', ParseObjectIdPipe) commentId: string,
    @Body() dto: UpdateCommentDto,
  ) {
    return this.comments.update(user.id, commentId, dto);
  }

  @Delete('comments/:commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a comment and its replies' })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('commentId', ParseObjectIdPipe) commentId: string,
  ) {
    return this.comments.remove(user.id, commentId);
  }
}
