import { WorkspaceRole } from '../authorization/permissions';

/**
 * Domain events emitted by services after a state change has been persisted.
 * Side effects (activity log, notifications, realtime fan-out) subscribe to
 * these instead of being called from every service.
 */

export interface FieldChange<T = unknown> {
  from: T;
  to: T;
}

interface BaseEvent {
  actorId: string;
  workspaceId: string;
  projectId?: string;
  taskId?: string;
  /** Id of the primary entity the event is about. */
  entityId: string;
}

export interface MemberJoinedEvent extends BaseEvent {
  type: 'workspace.member.joined';
  userId: string;
  role: WorkspaceRole;
}

export interface MemberRemovedEvent extends BaseEvent {
  type: 'workspace.member.removed';
  userId: string;
}

export interface MemberRoleChangedEvent extends BaseEvent {
  type: 'workspace.member.role_changed';
  userId: string;
  changes: { role: FieldChange<WorkspaceRole> };
}

export interface InvitationCreatedEvent extends BaseEvent {
  type: 'invitation.created';
  email: string;
  role: WorkspaceRole;
  workspaceName: string;
  inviterName: string;
  /** Set when the invitee already has an account. */
  inviteeUserId: string | null;
}

export interface ProjectCreatedEvent extends BaseEvent {
  type: 'project.created';
  name: string;
}

export interface ProjectUpdatedEvent extends BaseEvent {
  type: 'project.updated';
  name: string;
  changes: Record<string, FieldChange>;
}

export interface ProjectDeletedEvent extends BaseEvent {
  type: 'project.deleted';
  name: string;
}

export interface ProjectMemberAddedEvent extends BaseEvent {
  type: 'project.member.added';
  userId: string;
  projectName: string;
}

export interface ProjectMemberRemovedEvent extends BaseEvent {
  type: 'project.member.removed';
  userId: string;
  projectName: string;
}

export interface TaskCreatedEvent extends BaseEvent {
  type: 'task.created';
  title: string;
  assigneeId: string | null;
  parentTaskId: string | null;
}

export interface TaskUpdatedEvent extends BaseEvent {
  type: 'task.updated';
  title: string;
  createdById: string;
  assigneeId: string | null;
  changes: Record<string, FieldChange>;
}

export interface TaskDeletedEvent extends BaseEvent {
  type: 'task.deleted';
  title: string;
}

export interface CommentCreatedEvent extends BaseEvent {
  type: 'comment.created';
  taskTitle: string;
  /** Users following the task (creator + assignee), excluding the actor. */
  watcherIds: string[];
  mentionedUserIds: string[];
}

export interface CommentDeletedEvent extends BaseEvent {
  type: 'comment.deleted';
}

export interface AttachmentUploadedEvent extends BaseEvent {
  type: 'attachment.uploaded';
  fileName: string;
}

export interface AttachmentDeletedEvent extends BaseEvent {
  type: 'attachment.deleted';
  fileName: string;
}

export interface DependencyAddedEvent extends BaseEvent {
  type: 'dependency.added';
  blockingTaskId: string;
  blockedTaskId: string;
}

export interface DependencyRemovedEvent extends BaseEvent {
  type: 'dependency.removed';
  blockingTaskId: string;
  blockedTaskId: string;
}

export interface LabelDeletedEvent extends BaseEvent {
  type: 'label.deleted';
  name: string;
}

export type DomainEvent =
  | MemberJoinedEvent
  | MemberRemovedEvent
  | MemberRoleChangedEvent
  | InvitationCreatedEvent
  | ProjectCreatedEvent
  | ProjectUpdatedEvent
  | ProjectDeletedEvent
  | ProjectMemberAddedEvent
  | ProjectMemberRemovedEvent
  | TaskCreatedEvent
  | TaskUpdatedEvent
  | TaskDeletedEvent
  | CommentCreatedEvent
  | CommentDeletedEvent
  | AttachmentUploadedEvent
  | AttachmentDeletedEvent
  | DependencyAddedEvent
  | DependencyRemovedEvent
  | LabelDeletedEvent;

export type DomainEventType = DomainEvent['type'];

/** Emitted by NotificationsService for transports (websocket, push) — not a workspace activity. */
export const NOTIFICATION_CREATED = 'notification.created';
export interface NotificationCreatedEvent {
  recipientId: string;
  notificationId: string;
}

/** Every domain event name; for subscribers that react to all of them (activity log, realtime). */
export const ALL_DOMAIN_EVENTS: DomainEventType[] = [
  'workspace.member.joined',
  'workspace.member.removed',
  'workspace.member.role_changed',
  'invitation.created',
  'project.created',
  'project.updated',
  'project.deleted',
  'project.member.added',
  'project.member.removed',
  'task.created',
  'task.updated',
  'task.deleted',
  'comment.created',
  'comment.deleted',
  'attachment.uploaded',
  'attachment.deleted',
  'dependency.added',
  'dependency.removed',
  'label.deleted',
];
