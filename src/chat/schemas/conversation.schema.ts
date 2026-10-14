import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, Types } from 'mongoose';
import { Persisted } from '../../common/types/persisted';

export enum ConversationType {
  DIRECT = 'DIRECT',
  GROUP = 'GROUP',
}

export const MAX_GROUP_NAME_LENGTH = 60;
/** Including the creator. */
export const MAX_GROUP_MEMBERS = 50;

/** A participant and how far they have read (a message `seq`). */
@Schema({ _id: false })
export class ConversationMember {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ type: Number, default: 0, min: 0 })
  lastReadSeq: number;

  /** "Delete chat": messages up to this seq are gone for this member. */
  @Prop({ type: Number, default: 0, min: 0 })
  clearedSeq: number;

  /** Out of this member's inbox until a new message arrives. */
  @Prop({ type: Boolean, default: false })
  hidden: boolean;
}
const ConversationMemberSchema =
  SchemaFactory.createForClass(ConversationMember);

/** Denormalised so the inbox renders without reading messages. */
@Schema({ _id: false })
export class LastMessage {
  @Prop({ type: SchemaTypes.ObjectId, required: true })
  id: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  sender: Types.ObjectId;

  @Prop({ required: true })
  preview: string;

  @Prop({ type: Number, required: true })
  seq: number;

  @Prop({ type: Date, required: true })
  createdAt: Date;
}
const LastMessageSchema = SchemaFactory.createForClass(LastMessage);

/**
 * A direct conversation between two members of one workspace, or a named
 * group of members (chats are workspace-scoped, like the rest of Taskify). Reading or writing requires
 * being a participant AND an active member of the workspace, so leaving a
 * workspace ends access to its conversations.
 */
@Schema({ timestamps: true, collection: 'conversations' })
export class Conversation {
  @Prop({
    type: SchemaTypes.ObjectId,
    ref: 'Workspace',
    required: true,
    immutable: true,
  })
  workspace: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(ConversationType),
    default: ConversationType.DIRECT,
    immutable: true,
  })
  type: ConversationType;

  /**
   * DM: `<workspace>:<userA>:<userB>` (sorted). Unique, so a pair has one DM
   * per workspace. Group: `group:<random id>`.
   */
  @Prop({ type: String, required: true, immutable: true })
  directKey: string;

  @Prop({ type: [ConversationMemberSchema], required: true })
  members: ConversationMember[];

  /** Groups only. */
  @Prop({ type: String, default: null, maxlength: MAX_GROUP_NAME_LENGTH })
  name: string | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', default: null })
  createdBy: Types.ObjectId | null;

  /** Highest message `seq` handed out; messages are numbered 1, 2, 3, … */
  @Prop({ type: Number, default: 0, min: 0 })
  lastSeq: number;

  @Prop({ type: LastMessageSchema, default: null })
  lastMessage: LastMessage | null;

  /** Null until the first message, which keeps empty DMs out of the inbox. */
  @Prop({ type: Date, default: null })
  lastMessageAt: Date | null;
}

export type ConversationRecord = Persisted<Conversation>;
export const ConversationSchema = SchemaFactory.createForClass(Conversation);

ConversationSchema.index({ directKey: 1 }, { unique: true });
// Inbox: my conversations, most recent first.
ConversationSchema.index({ 'members.user': 1, lastMessageAt: -1 });
