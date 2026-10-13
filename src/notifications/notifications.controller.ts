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
  RegisterDeviceDto,
  UnregisterDeviceDto,
} from './dtos/device-token.dto';
import { ListNotificationsQueryDto } from './dtos/notification.dto';
import { NotificationsService } from './notifications.service';
import { PushService } from './push/push.service';

@ApiTags('Notifications')
@ApiBearerAuth('JWT-auth')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly push: PushService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List my notifications' })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notifications.list(user.id, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Number of unread notifications' })
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.notifications.unreadCount(user.id);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all my notifications as read' })
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.id);
  }

  @Post('devices')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Register this device for push notifications' })
  registerDevice(
    @CurrentUser() user: AuthUser,
    @Body() dto: RegisterDeviceDto,
  ) {
    return this.push.register(user.id, dto.token, dto.platform);
  }

  // Declared before `:id` so "devices" isn't parsed as a notification id.
  @Delete('devices')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Stop push notifications to this device' })
  unregisterDevice(
    @CurrentUser() user: AuthUser,
    @Body() dto: UnregisterDeviceDto,
  ) {
    return this.push.unregister(user.id, dto.token);
  }

  @Delete()
  @ApiOperation({ summary: 'Delete all my notifications (or only read ones)' })
  removeAll(
    @CurrentUser() user: AuthUser,
    @Query('readOnly') readOnly?: string,
  ) {
    return this.notifications.removeAll(user.id, readOnly === 'true');
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete one of my notifications' })
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return this.notifications.remove(user.id, id);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  markRead(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return this.notifications.markRead(user.id, id);
  }
}
