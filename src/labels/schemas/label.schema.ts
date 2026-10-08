import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, Types } from 'mongoose';
import { Persisted } from '../../common/types/persisted';

/** Labels are shared by every project in a workspace and attached to tasks by id. */
@Schema({ timestamps: true })
export class Label {
  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'Workspace',
    required: true,
    immutable: true,
  })
  workspace: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 40 })
  name: string;

  @Prop({ required: true, match: /^#[0-9a-fA-F]{6}$/, default: '#64748b' })
  color: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;
}

export type LabelRecord = Persisted<Label>;
export const LabelSchema = SchemaFactory.createForClass(Label);

// Case-insensitive uniqueness: "Bug" and "bug" are the same label.
LabelSchema.index(
  { workspace: 1, name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } },
);
