import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, Types } from 'mongoose';
import { Persisted } from '../../common/types/persisted';

export enum TaskStatus {
  TODO = 'TODO',
  IN_PROGRESS = 'IN_PROGRESS',
  IN_REVIEW = 'IN_REVIEW',
  BLOCKED = 'BLOCKED',
  DONE = 'DONE',
}

export enum TaskPriority {
  URGENT = 'URGENT',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

/**
 * Tasks and subtasks share one collection: a subtask is a Task with
 * `parentTask` set. Progress of a parent is computed from its children at
 * read time — never stored.
 */
@Schema({ timestamps: true })
export class Task {
  /** Denormalised from the project so workspace-scoped queries (search, dashboard, my tasks) need no join. */
  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'Workspace',
    required: true,
    immutable: true,
  })
  workspace: Types.ObjectId;

  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'Project',
    required: true,
    immutable: true,
  })
  project: Types.ObjectId;

  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'Task',
    default: null,
    immutable: true,
  })
  parentTask: Types.ObjectId | null;

  @Prop({ required: true, trim: true, maxlength: 200 })
  title: string;

  @Prop({ type: String, trim: true, maxlength: 10000, default: '' })
  description: string;

  @Prop({
    type: String,
    enum: Object.values(TaskStatus),
    default: TaskStatus.TODO,
  })
  status: TaskStatus;

  @Prop({
    type: String,
    enum: Object.values(TaskPriority),
    default: TaskPriority.MEDIUM,
  })
  priority: TaskPriority;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', default: null })
  assignee: Types.ObjectId | null;

  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'User',
    required: true,
    immutable: true,
  })
  createdBy: Types.ObjectId;

  @Prop({ type: [{ type: SchemaTypes.ObjectId, ref: 'Label' }], default: [] })
  labels: Types.ObjectId[];

  @Prop({ type: Date, default: null })
  startDate: Date | null;

  @Prop({ type: Date, default: null })
  dueDate: Date | null;

  /** Set when the task enters DONE; cleared if reopened. */
  @Prop({ type: Date, default: null })
  completedAt: Date | null;

  @Prop({ type: Number, min: 0, default: null })
  estimatedHours: number | null;

  /** Manual ordering inside a board column. */
  @Prop({ type: Number, default: 0 })
  position: number;

  @Prop({ type: Date, default: null })
  dueReminderSentAt: Date | null;

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;
}

export type TaskRecord = Persisted<Task>;
export const TaskSchema = SchemaFactory.createForClass(Task);

TaskSchema.index({ project: 1, deletedAt: 1, status: 1, position: 1 });
TaskSchema.index({ assignee: 1, deletedAt: 1, status: 1, dueDate: 1 });
TaskSchema.index({ workspace: 1, deletedAt: 1, dueDate: 1 });
TaskSchema.index({ parentTask: 1 });
TaskSchema.index({ labels: 1 });
TaskSchema.index({ status: 1, dueDate: 1, dueReminderSentAt: 1 });
