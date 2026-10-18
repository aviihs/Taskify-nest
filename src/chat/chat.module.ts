import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationsModule } from '../notifications/notifications.module';
import { UserSchema, UserSchemaName } from '../users/schemas/user.schema';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import {
  WorkspaceMember,
  WorkspaceMemberSchema,
} from '../workspaces/schemas/workspace-member.schema';
import {
  Workspace,
  WorkspaceSchema,
} from '../workspaces/schemas/workspace.schema';
import { ChatPushListener } from './chat-push.listener';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { PresenceModule } from './presence.module';
import { PresenceService } from './presence.service';
import { ChatMessage, ChatMessageSchema } from './schemas/chat-message.schema';
import {
  Conversation,
  ConversationSchema,
} from './schemas/conversation.schema';
import {
  PresenceSession,
  PresenceSessionSchema,
} from './schemas/presence-session.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
      { name: ChatMessage.name, schema: ChatMessageSchema },
      { name: PresenceSession.name, schema: PresenceSessionSchema },
      // Read-only: contacts, names and availability.
      { name: WorkspaceMember.name, schema: WorkspaceMemberSchema },
      { name: Workspace.name, schema: WorkspaceSchema },
      { name: UserSchemaName, schema: UserSchema },
    ]),
    WorkspacesModule,
    NotificationsModule,
    PresenceModule,
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatPushListener],
  exports: [ChatService, PresenceModule],
})
export class ChatModule {}
