import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, Types } from 'mongoose';
import { Persisted } from '../../common/types/persisted';

/** A user-authored message on a task. System history lives in ActivityLog, never here. */
@Schema({ timestamps: true, collection: 'comments' })
export class Comment {
  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'Task',
    required: true,
    immutable: true,
  })
  task: Types.ObjectId;

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
    ref: 'User',
    required: true,
    immutable: true,
  })
  author: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 5000 })
  content: string;

  /** One level of threading: replies point at a top-level comment. */
  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'Comment',
    default: null,
    immutable: true,
  })
  parentComment: Types.ObjectId | null;

  @Prop({ type: [{ type: SchemaTypes.ObjectId, ref: 'User' }], default: [] })
  mentions: Types.ObjectId[];

  @Prop({ type: Date, default: null })
  editedAt: Date | null;
}

export type CommentRecord = Persisted<Comment>;
export const CommentSchema = SchemaFactory.createForClass(Comment);

CommentSchema.index({ task: 1, parentComment: 1, createdAt: 1 });
CommentSchema.index({ project: 1, createdAt: -1 });
