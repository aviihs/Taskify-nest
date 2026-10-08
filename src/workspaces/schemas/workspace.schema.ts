import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, Types } from 'mongoose';
import { Persisted } from '../../common/types/persisted';

export enum WorkspaceType {
  PERSONAL = 'PERSONAL',
  ORGANIZATION = 'ORGANIZATION',
}

@Schema({ timestamps: true })
export class Workspace {
  @Prop({ required: true, trim: true, maxlength: 80 })
  name: string;

  @Prop({ type: String, trim: true, maxlength: 500, default: null })
  description: string | null;

  @Prop({ type: String, default: null })
  avatar: string | null;

  @Prop({
    type: String,
    enum: Object.values(WorkspaceType),
    required: true,
    immutable: true,
  })
  type: WorkspaceType;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  owner: Types.ObjectId;

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;
}

export type WorkspaceRecord = Persisted<Workspace>;
export const WorkspaceSchema = SchemaFactory.createForClass(Workspace);

// Exactly one personal workspace per user.
WorkspaceSchema.index(
  { owner: 1, type: 1 },
  { unique: true, partialFilterExpression: { type: WorkspaceType.PERSONAL } },
);
