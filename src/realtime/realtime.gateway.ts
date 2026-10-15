import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { isValidObjectId } from 'mongoose';
import { Server, Socket } from 'socket.io';
import {
  CHAT_CONVERSATION_CREATED,
  CHAT_MESSAGE_CREATED,
  CHAT_MESSAGES_DELETED,
  CHAT_READ,
  ChatConversationCreatedEvent,
  ChatMessageCreatedEvent,
  ChatMessagesDeletedEvent,
  ChatReadEvent,
  PRESENCE_CHANGED,
  PresenceChangedEvent,
} from '../chat/chat-events';
import { ChatService } from '../chat/chat.service';
import { PresenceService } from '../chat/presence.service';
import { Permission } from '../common/authorization/permissions';
import {
  ALL_DOMAIN_EVENTS,
  DomainEvent,
  InvitationClosedEvent,
  InvitationCreatedEvent,
  MemberRemovedEvent,
  MemberRoleChangedEvent,
  MemberStatusChangedEvent,
  NOTIFICATION_CREATED,
  NotificationCreatedEvent,
  ProjectMemberRemovedEvent,
} from '../common/events/domain-events';
import { OnDomainEvent } from '../common/events/on-domain-event.decorator';
import {
  extractBearerToken,
  JwtAuthGuard,
} from '../common/guards/jwt-auth.guard';
import { AuthUser } from '../common/types/auth-user';
import { ProjectAccessService } from '../projects/project-access.service';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';

const rooms = {
  user: (id: string) => `user:${id}`,
  workspace: (id: string) => `workspace:${id}`,
  project: (id: string) => `project:${id}`,
};

interface SubscribePayload {
  workspaceId?: string;
  projectId?: string;
}

type Ack = { ok: true } | { ok: false; error: string };

interface TypingPayload {
  conversationId?: string;
  typing?: boolean;
}

/** A "typing: true" is forwarded at most this often per conversation and socket. */
export const TYPING_THROTTLE_MS = 2_000;
/** How long a socket's conversation access check is reused for typing events. */
const CHAT_ACCESS_CACHE_MS = 30_000;

/** Per-socket chat state (lives in `socket.data`). */
interface ChatSocketState {
  /** conversationId → other participants, and when that check expires. */
  access: Map<string, { peers: string[]; expiresAt: number }>;
  /** conversationId → when "typing" was last forwarded. */
  typingSentAt: Map<string, number>;
}

/**
 * Pushes lightweight change signals to clients. Payloads carry ids only;
 * clients refetch through the REST API, so no data bypasses authorization.
 * Rooms are joined only after the same access checks REST uses.
 */
@WebSocketGateway({
  namespace: '/realtime',
  cors: { origin: true, credentials: true },
})
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private readonly server: Server;

  constructor(
    private readonly auth: JwtAuthGuard,
    private readonly workspaceAccess: WorkspaceAccessService,
    private readonly projectAccess: ProjectAccessService,
    private readonly chat: ChatService,
    private readonly presence: PresenceService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const token =
      (client.handshake.auth?.token as string | undefined) ??
      extractBearerToken(client.handshake.headers.authorization);
    const user = token ? this.auth.verifyAccessToken(token) : null;
    if (!user) {
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect(true);
      return;
    }
    client.data.user = user;
    client.data.chat = {
      access: new Map(),
      typingSentAt: new Map(),
    } as ChatSocketState;
    client.join(rooms.user(user.id));
    try {
      await this.presence.connected(user.id, client.id);
    } catch (error) {
      this.logger.warn(`Presence connect failed: ${String(error)}`);
    }
  }

  /** Clears the user's typing indicators and presence session for this socket. */
  async handleDisconnect(client: Socket): Promise<void> {
    const user: AuthUser | undefined = client.data.user;
    if (!user) return;
    const state: ChatSocketState | undefined = client.data.chat;
    for (const conversationId of state?.typingSentAt.keys() ?? []) {
      const peers = state?.access.get(conversationId)?.peers ?? [];
      this.emitTyping(peers, conversationId, user.id, false);
    }
    try {
      await this.presence.disconnected(user.id, client.id);
    } catch (error) {
      this.logger.warn(`Presence disconnect failed: ${String(error)}`);
    }
  }

  /**
   * Ephemeral: never stored. Forwarded only to the other participants of a
   * conversation the sender may access; "typing" is throttled per socket and
   * receivers expire it on their own if no refresh arrives.
   */
  @SubscribeMessage('chat:typing')
  async typing(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: TypingPayload,
  ): Promise<Ack> {
    const user: AuthUser = client.data.user;
    const state: ChatSocketState = client.data.chat;
    const conversationId = payload?.conversationId;
    if (
      !user ||
      !state ||
      !conversationId ||
      !isValidObjectId(conversationId)
    ) {
      return { ok: false, error: 'conversationId is required' };
    }
    const typing = payload.typing === true;

    let access = state.access.get(conversationId);
    if (!access || access.expiresAt < Date.now()) {
      try {
        const peers = await this.chat.peersOf(user.id, conversationId);
        access = { peers, expiresAt: Date.now() + CHAT_ACCESS_CACHE_MS };
        state.access.set(conversationId, access);
      } catch {
        state.access.delete(conversationId);
        return { ok: false, error: 'Not found' };
      }
    }

    const lastSent = state.typingSentAt.get(conversationId);
    if (typing) {
      if (
        lastSent !== undefined &&
        Date.now() - lastSent < TYPING_THROTTLE_MS
      ) {
        return { ok: true };
      }
      state.typingSentAt.set(conversationId, Date.now());
    } else {
      if (lastSent === undefined) return { ok: true };
      state.typingSentAt.delete(conversationId);
    }
    this.emitTyping(access.peers, conversationId, user.id, typing);
    return { ok: true };
  }

  private emitTyping(
    peers: string[],
    conversationId: string,
    userId: string,
    typing: boolean,
  ): void {
    if (!peers.length) return;
    this.server
      .to(peers.map(rooms.user))
      .emit('chat:typing', { conversationId, userId, typing });
  }

  /**
   * Chat messages carry their content (unlike change signals) so they appear
   * instantly; they go only to the participants' personal rooms, after the
   * service has authorized the sender. The sender's copy carries `clientId`
   * so their device can reconcile its optimistic message.
   */
  @OnDomainEvent(CHAT_MESSAGE_CREATED)
  pushChatMessage(event: ChatMessageCreatedEvent): void {
    const { message, sender } = event;
    const { clientId, ...shared } = message;
    for (const memberId of event.memberIds) {
      const isSender = memberId === message.senderId;
      this.server.to(rooms.user(memberId)).emit('chat:message', {
        message: isSender ? { ...shared, clientId } : shared,
        sender,
      });
    }
    // Sending ends the sender's typing state for everyone else.
    const peers = event.memberIds.filter((id) => id !== message.senderId);
    this.emitTyping(peers, message.conversationId, message.senderId, false);
  }

  @OnDomainEvent(CHAT_READ)
  pushChatRead(event: ChatReadEvent): void {
    this.server.to(event.memberIds.map(rooms.user)).emit('chat:read', {
      conversationId: event.conversationId,
      userId: event.userId,
      lastReadSeq: event.lastReadSeq,
    });
  }

  @OnDomainEvent(CHAT_CONVERSATION_CREATED)
  pushChatCreated(event: ChatConversationCreatedEvent): void {
    this.server
      .to(event.memberIds.map(rooms.user))
      .emit('chat:conversation', { conversationId: event.conversationId });
  }

  @OnDomainEvent(CHAT_MESSAGES_DELETED)
  pushChatDeleted(event: ChatMessagesDeletedEvent): void {
    this.server.to(event.memberIds.map(rooms.user)).emit('chat:deleted', {
      conversationId: event.conversationId,
      messageIds: event.messageIds,
      forEveryone: event.forEveryone,
      cleared: event.cleared,
    });
  }

  /**
   * Presence goes to the rooms of the user's workspaces — exactly the people
   * allowed to see them as a contact — and to the user's own devices.
   */
  @OnDomainEvent(PRESENCE_CHANGED)
  async pushPresence(event: PresenceChangedEvent): Promise<void> {
    const memberships = await this.workspaceAccess.memberships(event.userId);
    const targets = [
      rooms.user(event.userId),
      ...memberships.map((m) => rooms.workspace(String(m.workspaceId))),
    ];
    this.server
      .to(targets)
      .emit('presence', { userId: event.userId, online: event.online });
  }

  @SubscribeMessage('subscribe')
  async subscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SubscribePayload,
  ): Promise<Ack> {
    const user: AuthUser = client.data.user;
    try {
      if (payload?.projectId && isValidObjectId(payload.projectId)) {
        await this.projectAccess.authorize(
          user.id,
          payload.projectId,
          Permission.PROJECT_READ,
        );
        client.join(rooms.project(payload.projectId));
        return { ok: true };
      }
      if (payload?.workspaceId && isValidObjectId(payload.workspaceId)) {
        await this.workspaceAccess.authorize(
          user.id,
          payload.workspaceId,
          Permission.WORKSPACE_READ,
        );
        client.join(rooms.workspace(payload.workspaceId));
        return { ok: true };
      }
      return { ok: false, error: 'workspaceId or projectId is required' };
    } catch {
      return { ok: false, error: 'Not found' };
    }
  }

  @SubscribeMessage('unsubscribe')
  unsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SubscribePayload,
  ): Ack {
    if (payload?.projectId) client.leave(rooms.project(payload.projectId));
    if (payload?.workspaceId)
      client.leave(rooms.workspace(payload.workspaceId));
    return { ok: true };
  }

  /** Project-scoped events go to the project room; workspace-level events to the workspace room. */
  @OnDomainEvent(...ALL_DOMAIN_EVENTS)
  broadcast(event: DomainEvent): void {
    const room = event.projectId
      ? rooms.project(event.projectId)
      : rooms.workspace(event.workspaceId);
    this.server.to(room).emit('event', {
      type: event.type,
      workspaceId: event.workspaceId,
      projectId: event.projectId ?? null,
      taskId: event.taskId ?? null,
      entityId: event.entityId,
      actorId: event.actorId,
    });
  }

  @OnDomainEvent(NOTIFICATION_CREATED)
  pushNotification(event: NotificationCreatedEvent): void {
    this.server
      .to(rooms.user(event.recipientId))
      .emit('notification', { notificationId: event.notificationId });
  }

  /**
   * The invitee is not in the workspace room yet, so invitation changes are
   * also pushed to their personal room ("refresh your invitations").
   */
  @OnDomainEvent('invitation.created', 'invitation.cancelled')
  pushInvitation(event: InvitationCreatedEvent | InvitationClosedEvent): void {
    if (!event.inviteeUserId) return;
    this.server.to(rooms.user(event.inviteeUserId)).emit('invitation', {
      type: event.type,
      invitationId: event.entityId,
      workspaceId: event.workspaceId,
    });
  }

  /**
   * Revoked or reduced access must also revoke live subscriptions: removal,
   * suspension, or a role that no longer sees every project. Forces a
   * reconnect, after which every room is re-authorized.
   */
  @OnDomainEvent(
    'workspace.member.removed',
    'workspace.member.role_changed',
    'workspace.member.status_changed',
  )
  onMembershipChanged(
    event:
      | MemberRemovedEvent
      | MemberRoleChangedEvent
      | MemberStatusChangedEvent,
  ): void {
    this.server.in(rooms.user(event.userId)).disconnectSockets(true);
    this.logger.debug(
      `Disconnected sockets of ${event.userId} after ${event.type}`,
    );
  }

  @OnDomainEvent('project.member.removed')
  onProjectMemberRemoved(event: ProjectMemberRemovedEvent): void {
    this.server
      .in(rooms.user(event.userId))
      .socketsLeave(rooms.project(event.projectId));
  }
}
