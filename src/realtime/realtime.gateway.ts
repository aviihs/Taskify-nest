import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { isValidObjectId } from 'mongoose';
import { Server, Socket } from 'socket.io';
import { Permission } from '../common/authorization/permissions';
import {
  ALL_DOMAIN_EVENTS,
  DomainEvent,
  InvitationClosedEvent,
  InvitationCreatedEvent,
  MemberRemovedEvent,
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

/**
 * Pushes lightweight change signals to clients. Payloads carry ids only;
 * clients refetch through the REST API, so no data bypasses authorization.
 * Rooms are joined only after the same access checks REST uses.
 */
@WebSocketGateway({
  namespace: '/realtime',
  cors: { origin: true, credentials: true },
})
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private readonly server: Server;

  constructor(
    private readonly auth: JwtAuthGuard,
    private readonly workspaceAccess: WorkspaceAccessService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  handleConnection(client: Socket): void {
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
    client.join(rooms.user(user.id));
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

  /** Revoked access must also revoke live subscriptions. */
  @OnDomainEvent('workspace.member.removed')
  onWorkspaceMemberRemoved(event: MemberRemovedEvent): void {
    // Forces a reconnect, after which every room is re-authorized.
    this.server.in(rooms.user(event.userId)).disconnectSockets(true);
    this.logger.debug(`Disconnected sockets of removed member ${event.userId}`);
  }

  @OnDomainEvent('project.member.removed')
  onProjectMemberRemoved(event: ProjectMemberRemovedEvent): void {
    this.server
      .in(rooms.user(event.userId))
      .socketsLeave(rooms.project(event.projectId));
  }
}
