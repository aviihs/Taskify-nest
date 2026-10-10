import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, Types } from 'mongoose';
import { Persisted } from '../../common/types/persisted';

export const TASK_DEPENDENCY_COLLECTION = 'task_dependencies';

/** Directed edge: `blockingTask` must finish before `blockedTask`. */
@Schema({ timestamps: true, collection: TASK_DEPENDENCY_COLLECTION })
export class TaskDependency {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Project', required: true })
  project: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Task', required: true })
  blockingTask: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Task', required: true })
  blockedTask: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;
}

export type TaskDependencyRecord = Persisted<TaskDependency>;
export const TaskDependencySchema =
  SchemaFactory.createForClass(TaskDependency);

TaskDependencySchema.index(
  { blockingTask: 1, blockedTask: 1 },
  { unique: true },
);
TaskDependencySchema.index({ blockedTask: 1 });
