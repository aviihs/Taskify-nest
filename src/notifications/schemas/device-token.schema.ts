import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, Types } from 'mongoose';
import { Persisted } from '../../common/types/persisted';

export enum DevicePlatform {
  ANDROID = 'android',
  IOS = 'ios',
  WEB = 'web',
}

/** An FCM registration token; a user has one per signed-in device. */
@Schema({ timestamps: true, collection: 'device_tokens' })
export class DeviceToken {
  @Prop({ type: SchemaTypes.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;

  /** Unique: a device that signs into another account moves to that user. */
  @Prop({ required: true, unique: true, maxlength: 4096 })
  token: string;

  @Prop({ type: String, enum: Object.values(DevicePlatform), required: true })
  platform: DevicePlatform;
}

export type DeviceTokenRecord = Persisted<DeviceToken>;
export const DeviceTokenSchema = SchemaFactory.createForClass(DeviceToken);

DeviceTokenSchema.index({ user: 1 });
