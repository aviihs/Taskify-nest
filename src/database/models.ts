import { Schema } from 'mongoose';
import {
  UserIdentity,
  UserIdentitySchema,
} from '../auth/social/user-identity.schema';
import {
  ActivityLog,
  ActivityLogSchema,
} from '../activity/schemas/activity-log.schema';
import {
  Attachment,
  AttachmentSchema,
} from '../attachments/schemas/task-attachment.schema';
import {
  ChatMessage,
  ChatMessageSchema,
} from '../chat/schemas/chat-message.schema';
import {
  Conversation,
  ConversationSchema,
} from '../chat/schemas/conversation.schema';
import {
  PresenceSession,
  PresenceSessionSchema,
} from '../chat/schemas/presence-session.schema';
import {
  Comment,
  CommentSchema,
} from '../comments/schemas/task-comment.schema';
import {
  WorkspaceInvitation,
  WorkspaceInvitationSchema,
} from '../invitations/schemas/invitation.schema';
import { Label, LabelSchema } from '../labels/schemas/label.schema';
import { Note, NoteSchema } from '../notes/schemas/note.schema';
import {
  DeviceToken,
  DeviceTokenSchema,
} from '../notifications/schemas/device-token.schema';
import {
  Notification,
  NotificationSchema,
} from '../notifications/schemas/user-notification.schema';
import {
  ProjectMember,
  ProjectMemberSchema,
} from '../projects/schemas/project-member.schema';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import {
  TaskDependency,
  TaskDependencySchema,
} from '../task-dependencies/schemas/task-dependency.schema';
import { Task, TaskSchema } from '../tasks/schemas/task.schema';
import { UserSchema, UserSchemaName } from '../users/schemas/user.schema';
import {
  WorkspaceMember,
  WorkspaceMemberSchema,
} from '../workspaces/schemas/workspace-member.schema';
import {
  Workspace,
  WorkspaceSchema,
} from '../workspaces/schemas/workspace.schema';

export interface ModelDefinition {
  name: string;
  schema: Schema;
}

/**
 * Every Mongoose model in the application, in dependency order (parents
 * first). Feature modules still register what they use with `forFeature`;
 * this list is for tooling that works on the whole database (`db:check`,
 * `db:reset-dev`). See docs/DATA_MODEL.md.
 */
export const MODELS: ModelDefinition[] = [
  { name: UserSchemaName, schema: UserSchema },
  { name: UserIdentity.name, schema: UserIdentitySchema },
  { name: Workspace.name, schema: WorkspaceSchema },
  { name: WorkspaceMember.name, schema: WorkspaceMemberSchema },
  { name: WorkspaceInvitation.name, schema: WorkspaceInvitationSchema },
  { name: Project.name, schema: ProjectSchema },
  { name: ProjectMember.name, schema: ProjectMemberSchema },
  { name: Label.name, schema: LabelSchema },
  { name: Task.name, schema: TaskSchema },
  { name: TaskDependency.name, schema: TaskDependencySchema },
  { name: Comment.name, schema: CommentSchema },
  { name: Attachment.name, schema: AttachmentSchema },
  { name: DeviceToken.name, schema: DeviceTokenSchema },
  { name: Notification.name, schema: NotificationSchema },
  { name: ActivityLog.name, schema: ActivityLogSchema },
  { name: Note.name, schema: NoteSchema },
  { name: Conversation.name, schema: ConversationSchema },
  { name: ChatMessage.name, schema: ChatMessageSchema },
  { name: PresenceSession.name, schema: PresenceSessionSchema },
];

export const collectionOf = (model: ModelDefinition): string =>
  model.schema.get('collection');

/** Collections the application owns: one per model, plus the migration ledger. */
export const APP_COLLECTIONS = [...MODELS.map(collectionOf), '_migrations'];
