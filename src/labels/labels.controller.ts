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
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { AuthUser } from '../common/types/auth-user';
import { CreateLabelDto, UpdateLabelDto } from './dtos/label.dto';
import { LabelsService } from './labels.service';

@ApiTags('Labels')
@ApiBearerAuth('JWT-auth')
@Controller()
export class LabelsController {
  constructor(private readonly labels: LabelsService) {}

  @Get('workspaces/:workspaceId/labels')
  @ApiOperation({ summary: 'List workspace labels' })
  list(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId', ParseObjectIdPipe) workspaceId: string,
  ) {
    return this.labels.list(user.id, workspaceId);
  }

  @Post('workspaces/:workspaceId/labels')
  @ApiOperation({ summary: 'Create a label' })
  create(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId', ParseObjectIdPipe) workspaceId: string,
    @Body() dto: CreateLabelDto,
  ) {
    return this.labels.create(user.id, workspaceId, dto);
  }

  @Patch('labels/:labelId')
  @ApiOperation({ summary: 'Rename or recolor a label' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('labelId', ParseObjectIdPipe) labelId: string,
    @Body() dto: UpdateLabelDto,
  ) {
    return this.labels.update(user.id, labelId, dto);
  }

  @Delete('labels/:labelId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a label (removed from all tasks)' })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('labelId', ParseObjectIdPipe) labelId: string,
  ) {
    return this.labels.remove(user.id, labelId);
  }
}
