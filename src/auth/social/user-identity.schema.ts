import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, Types } from 'mongoose';
import { Persisted } from '../../common/types/persisted';
import { SOCIAL_PROVIDERS, SocialProvider } from './social-providers';

/**
 * Links a Firebase account to a Taskify user. Accounts are only ever linked
 * by Firebase UID, never by matching email.
 */
@Schema({ timestamps: true, collection: 'user_identities' })
export class UserIdentity {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  /** Unique: one Firebase account can never resolve to two Taskify users. */
  @Prop({ required: true, unique: true })
  firebaseUid: string;

  /** Provider used when the link was created (e.g. `google.com`). */
  @Prop({ type: String, enum: SOCIAL_PROVIDERS, required: true })
  provider: SocialProvider;

  /** Email the provider reported at link time; informational only. */
  @Prop({ type: String, default: null })
  email: string | null;
}

export type UserIdentityRecord = Persisted<UserIdentity>;
export const UserIdentitySchema = SchemaFactory.createForClass(UserIdentity);

UserIdentitySchema.index({ user: 1 });
