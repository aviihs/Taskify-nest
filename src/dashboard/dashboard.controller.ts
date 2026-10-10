import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TimezoneQueryDto } from '../common/dtos/timezone-query.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { AuthUser } from '../common/types/auth-user';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard')
@ApiBearerAuth('JWT-auth')
@Controller('workspaces/:workspaceId/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @ApiOperation({
    summary: 'Totals, overdue/due today, project progress and team workload',
  })
  get(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId', ParseObjectIdPipe) workspaceId: string,
    @Query() query: TimezoneQueryDto,
  ) {
    return this.dashboard.forWorkspace(user.id, workspaceId, query.tzOffset);
  }
}
