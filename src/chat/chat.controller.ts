import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { AuthUser } from '../common/types/auth-user';
import { ChatService } from './chat.service';
import {
  ContactsQueryDto,
  ListConversationsQueryDto,
  ListMessagesQueryDto,
  MarkReadDto,
  OpenDirectConversationDto,
  SendMessageDto,
  UpdatePresenceDto,
} from './dtos/chat.dto';
import { PresenceService } from './presence.service';

@ApiTags('Chat')
@ApiBearerAuth('JWT-auth')
@Controller('chat')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly presence: PresenceService,
  ) {}

  @Get('conversations')
  @ApiOperation({ summary: 'My conversations, most recent first' })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListConversationsQueryDto,
  ) {
    return this.chat.list(user.id, query);
  }

  @Post('conversations')
  @ApiOperation({
    summary:
      'Open the direct conversation with a workspace member (idempotent)',
  })
  open(@CurrentUser() user: AuthUser, @Body() dto: OpenDirectConversationDto) {
    return this.chat.openDirect(user.id, dto);
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'One conversation' })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    return this.chat.get(user.id, id);
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'Message history, paged by seq' })
  messages(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: ListMessagesQueryDto,
  ) {
    return this.chat.messages(user.id, id, query);
  }

  @Post('conversations/:id/messages')
  // A person typing fast is well under this; scripts are not.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send a message' })
  send(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.chat.send(user.id, id, dto);
  }

  @Post('conversations/:id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark messages up to seq as read' })
  read(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: MarkReadDto,
  ) {
    return this.chat.markRead(user.id, id, dto.seq);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread messages across all my conversations' })
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.chat.unreadTotal(user.id);
  }

  @Get('contacts')
  @ApiOperation({ summary: 'Workspace members I can message, with presence' })
  contacts(@CurrentUser() user: AuthUser, @Query() query: ContactsQueryDto) {
    return this.chat.contacts(user.id, query);
  }

  @Get('presence')
  @ApiOperation({ summary: 'My chosen availability and what others see' })
  async myPresence(@CurrentUser() user: AuthUser) {
    const [availability, online] = await Promise.all([
      this.presence.availability(user.id),
      this.presence.isOnline(user.id),
    ]);
    return { availability, online };
  }

  @Patch('presence')
  @ApiOperation({
    summary: 'Set availability: ONLINE or OFFLINE (appear offline)',
  })
  setPresence(@CurrentUser() user: AuthUser, @Body() dto: UpdatePresenceDto) {
    return this.presence.setAvailability(user.id, dto.availability);
  }
}
