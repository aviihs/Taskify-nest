import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, Types } from 'mongoose';
import { Persisted } from '../../common/types/persisted';

/** Append-only audit trail derived from domain events (e.g. status TODO → IN_PROGRESS). */
@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'activity_logs',
})
export class ActivityLog {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Workspace', required: true })
  workspace: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Project', default: null })
  project: Types.ObjectId | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Task', default: null })
  task: Types.ObjectId | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  actor: Types.ObjectId;

  /** Domain event type, e.g. `task.updated`. */
  @Prop({ required: true })
  action: string;

  @Prop({ required: true })
  entityType: string;

  @Prop({ type: SchemaTypes.ObjectId, required: true })
  entityId: Types.ObjectId;

  /** Event-specific details such as `changes: { status: { from, to } }`. */
  @Prop({ type: SchemaTypes.Mixed, default: {} })
  metadata: Record<string, unknown>;
}

export type ActivityLogRecord = Persisted<ActivityLog>;
export const ActivityLogSchema = SchemaFactory.createForClass(ActivityLog);

ActivityLogSchema.index({ workspace: 1, createdAt: -1 });
ActivityLogSchema.index({ project: 1, createdAt: -1 });
ActivityLogSchema.index({ task: 1, createdAt: -1 });
