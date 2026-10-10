import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { AuthUser } from '../common/types/auth-user';
import { ApplyBreakdownDto, TaskBreakdownRequestDto } from './ai.dto';
import { AiService } from './ai.service';

@ApiTags('AI')
@ApiBearerAuth('JWT-auth')
@Controller('projects/:projectId/ai/task-breakdown')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post()
  // @Throttle(10, 60)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: 'Suggest tasks and subtasks for a goal (nothing is saved)',
  })
  suggest(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Body() dto: TaskBreakdownRequestDto,
  ) {
    return this.ai.suggestBreakdown(user.id, projectId, dto.goal);
  }

  @Post('apply')
  @ApiOperation({
    summary: 'Add the chosen suggestions to the project as real tasks',
  })
  apply(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseObjectIdPipe) projectId: string,
    @Body() dto: ApplyBreakdownDto,
  ) {
    return this.ai.applyBreakdown(user.id, projectId, dto);
  }
}
