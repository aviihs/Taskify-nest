import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, Types } from 'mongoose';
import { Persisted } from '../../common/types/persisted';

export const MAX_MESSAGE_LENGTH = 4000;

/**
 * One chat message. `seq` is assigned by the server and orders the
 * conversation (pagination, unread counts, read receipts, reconnect sync);
 * `createdAt` is the server's clock, never the client's.
 */
@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'chat_messages',
})
export class ChatMessage {
  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'Conversation',
    required: true,
    immutable: true,
  })
  conversation: Types.ObjectId;

  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'Workspace',
    required: true,
    immutable: true,
  })
  workspace: Types.ObjectId;

  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'User',
    required: true,
    immutable: true,
  })
  sender: Types.ObjectId;

  /** Plain text; clients render it as text, never as markup. Emptied when
   *  the sender deletes the message for everyone. */
  @Prop({ type: String, default: '', maxlength: MAX_MESSAGE_LENGTH })
  body: string;

  @Prop({ type: Number, required: true, immutable: true })
  seq: number;

  /**
   * Idempotency key chosen by the sending device. A retried send with the
   * same key returns the stored message instead of creating a duplicate.
   */
  @Prop({ type: String, default: null, maxlength: 64, immutable: true })
  clientId: string | null;

  /** Sent with "Forward"; clients label it. */
  @Prop({ type: Boolean, default: false, immutable: true })
  forwarded: boolean;

  /** Deleted for everyone by its sender: the body is gone, a placeholder stays. */
  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  /** Participants who deleted this message for themselves only. */
  @Prop({ type: [SchemaTypes.ObjectId], ref: 'User', default: [] })
  hiddenFor: Types.ObjectId[];

  createdAt: Date;
}

export type ChatMessageRecord = Persisted<ChatMessage>;
export const ChatMessageSchema = SchemaFactory.createForClass(ChatMessage);

ChatMessageSchema.index({ conversation: 1, seq: -1 }, { unique: true });
ChatMessageSchema.index(
  { sender: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: 'string' } } },
);
