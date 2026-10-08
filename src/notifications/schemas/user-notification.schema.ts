import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, Types } from 'mongoose';
import { Persisted } from '../../common/types/persisted';

export enum NotificationType {
  TASK_ASSIGNED = 'TASK_ASSIGNED',
  TASK_STATUS_CHANGED = 'TASK_STATUS_CHANGED',
  TASK_DUE_SOON = 'TASK_DUE_SOON',
  COMMENT_ADDED = 'COMMENT_ADDED',
  MENTIONED = 'MENTIONED',
  WORKSPACE_INVITATION = 'WORKSPACE_INVITATION',
  PROJECT_MEMBER_ADDED = 'PROJECT_MEMBER_ADDED',
}

@Schema({ timestamps: true, collection: 'notifications' })
export class Notification {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  recipient: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(NotificationType), required: true })
  type: NotificationType;

  @Prop({ required: true, maxlength: 300 })
  message: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', default: null })
  actor: Types.ObjectId | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Workspace', default: null })
  workspace: Types.ObjectId | null;

  @Prop({ required: true })
  entityType: string;

  @Prop({ type: SchemaTypes.ObjectId, required: true })
  entityId: Types.ObjectId;

  /** Client route to open, e.g. `/tasks/:id`. */
  @Prop({ type: String, default: null })
  link: string | null;

  @Prop({ type: Date, default: null })
  readAt: Date | null;
}

export type NotificationRecord = Persisted<Notification>;
export const NotificationSchema = SchemaFactory.createForClass(Notification);

NotificationSchema.index({ recipient: 1, readAt: 1, createdAt: -1 });
