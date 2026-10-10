import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, Types } from 'mongoose';
import { Persisted } from '../../common/types/persisted';

/** Metadata only — file bytes live in StorageService under `storageKey`. */
@Schema({ timestamps: true, collection: 'attachments' })
export class Attachment {
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
  uploadedBy: Types.ObjectId;

  @Prop({ required: true, maxlength: 255 })
  fileName: string;

  @Prop({ required: true })
  mimeType: string;

  @Prop({ required: true, min: 0 })
  size: number;

  /** Never exposed to clients; downloads go through the authorized endpoint. */
  @Prop({ required: true, select: false })
  storageKey: string;
}

export type AttachmentRecord = Persisted<Attachment>;
export const AttachmentSchema = SchemaFactory.createForClass(Attachment);

AttachmentSchema.index({ task: 1, createdAt: -1 });
