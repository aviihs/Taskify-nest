import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, Types } from 'mongoose';
import { Persisted } from '../../common/types/persisted';

export const MAX_NOTE_TITLE = 120;
export const MAX_NOTE_DESCRIPTION = 2000;

/**
 * A private note. Only its owner can see it; it belongs to no workspace.
 * With `remindAt` set, the owner gets one reminder notification at that time.
 */
@Schema({ timestamps: true, collection: 'notes' })
export class Note {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ required: true, maxlength: MAX_NOTE_TITLE })
  title: string;

  @Prop({ type: String, default: '', maxlength: MAX_NOTE_DESCRIPTION })
  description: string;

  @Prop({ type: Date, default: null })
  remindAt: Date | null;

  /** Set when the reminder went out; cleared when remindAt changes. */
  @Prop({ type: Date, default: null })
  reminderSentAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export type NoteRecord = Persisted<Note>;
export const NoteSchema = SchemaFactory.createForClass(Note);

// My notes, soonest reminder first.
NoteSchema.index({ user: 1, remindAt: 1 });
// The reminder sweep.
NoteSchema.index({ reminderSentAt: 1, remindAt: 1 });
