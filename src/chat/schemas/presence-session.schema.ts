import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, Types } from 'mongoose';
import { Persisted } from '../../common/types/persisted';

/**
 * One live realtime socket. A user is connected while they have at least one
 * fresh session; `lastSeenAt` is refreshed by the API instance holding the
 * socket, so sessions of a crashed instance go stale and get swept.
 */
@Schema({ collection: 'presence_sessions' })
export class PresenceSession {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  @Prop({ required: true })
  socketId: string;

  /** Which API process owns the socket. */
  @Prop({ required: true })
  instanceId: string;

  @Prop({ type: Date, required: true })
  lastSeenAt: Date;
}

export type PresenceSessionRecord = Persisted<PresenceSession>;
export const PresenceSessionSchema =
  SchemaFactory.createForClass(PresenceSession);

PresenceSessionSchema.index({ socketId: 1 }, { unique: true });
PresenceSessionSchema.index({ user: 1, lastSeenAt: -1 });
// Safety net only; the sweeper removes stale sessions (and announces it) first.
PresenceSessionSchema.index({ lastSeenAt: 1 }, { expireAfterSeconds: 3600 });
