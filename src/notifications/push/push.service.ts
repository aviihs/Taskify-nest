import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { readFileSync } from 'fs';
import {
  cert,
  getApps,
  initializeApp,
  ServiceAccount,
} from 'firebase-admin/app';
import { getMessaging, Messaging } from 'firebase-admin/messaging';
import { Model } from 'mongoose';
import { env } from '../../common/config/env.config';
import { toObjectId } from '../../common/utils/query';
import { DevicePlatform, DeviceToken } from '../schemas/device-token.schema';

export interface PushPayload {
  title: string;
  body: string;
  /** String-only key/values delivered to the app (FCM requirement). */
  data: Record<string, string>;
}

/** Android channel created by the mobile app (NotificationService). */
const ANDROID_CHANNEL_ID = 'taskify_high_importance';

/** FCM errors that mean the token will never work again. */
const DEAD_TOKEN_ERRORS = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/** Device token registry plus FCM delivery. No-op when Firebase isn't configured. */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private messaging: Messaging | null = null;

  constructor(
    @InjectModel(DeviceToken.name)
    private readonly deviceTokenModel: Model<DeviceToken>,
  ) {}

  onModuleInit(): void {
    const raw = env.firebaseServiceAccount.trim();
    if (!raw) {
      this.logger.warn('FIREBASE_SERVICE_ACCOUNT not set — push disabled');
      return;
    }
    try {
      const json = raw.startsWith('{') ? raw : readFileSync(raw, 'utf8');
      const account = JSON.parse(json) as ServiceAccount;
      const app = getApps()[0] ?? initializeApp({ credential: cert(account) });
      this.messaging = getMessaging(app);
      this.logger.log('Firebase push enabled');
    } catch (error) {
      this.logger.error(
        'Invalid FIREBASE_SERVICE_ACCOUNT — push disabled',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  get enabled(): boolean {
    return this.messaging !== null;
  }

  async register(
    userId: string,
    token: string,
    platform: DevicePlatform,
  ): Promise<void> {
    await this.deviceTokenModel
      .updateOne(
        { token },
        { user: toObjectId(userId), token, platform },
        { upsert: true },
      )
      .exec();
  }

  /** Scoped by user: nobody can unregister someone else's device. */
  async unregister(userId: string, token: string): Promise<void> {
    await this.deviceTokenModel
      .deleteOne({ token, user: toObjectId(userId) })
      .exec();
  }

  /** Sends to every device of the user; prunes tokens FCM reports as dead. */
  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    if (!this.messaging) return;
    const devices = await this.deviceTokenModel
      .find({ user: toObjectId(userId) }, { token: 1 })
      .lean()
      .exec();
    if (!devices.length) return;

    const tokens = devices.map((device) => device.token);
    const response = await this.messaging.sendEachForMulticast({
      tokens,
      notification: { title: payload.title, body: payload.body },
      data: payload.data,
      android: {
        priority: 'high',
        notification: { channelId: ANDROID_CHANNEL_ID, sound: 'default' },
      },
      apns: {
        payload: { aps: { sound: 'default' } },
      },
    });

    const dead = response.responses
      .map((result, i) =>
        !result.success && DEAD_TOKEN_ERRORS.has(result.error?.code ?? '')
          ? tokens[i]
          : null,
      )
      .filter((token): token is string => token !== null);
    if (dead.length) {
      await this.deviceTokenModel.deleteMany({ token: { $in: dead } }).exec();
    }
    if (response.failureCount > dead.length) {
      this.logger.warn(
        `Push to user ${userId}: ${response.failureCount - dead.length} failed`,
      );
    }
  }
}
