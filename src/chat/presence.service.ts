import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { Model, Types } from 'mongoose';
import { toObjectId } from '../common/utils/query';
import { UserSchemaName } from '../users/schemas/user.schema';
import { PRESENCE_CHANGED, PresenceChangedEvent } from './chat-events';
import { Availability } from './dtos/chat.dto';
import { PresenceSession } from './schemas/presence-session.schema';

/** How often this instance vouches for the sockets it holds. */
export const PRESENCE_HEARTBEAT_MS = 30_000;
/** A session not vouched for in this long belongs to a dead instance. */
export const PRESENCE_STALE_MS = 90_000;

interface AvailabilityDoc {
  _id: Types.ObjectId;
  availability?: Availability;
}

/**
 * Who is online. Two separate inputs:
 * - connectivity: live realtime sockets, tracked per socket in Mongo so every
 *   API instance (and every device) counts;
 * - availability: what the user chose (ONLINE / appear OFFLINE).
 * Others see a user online only when both say so. Socket.IO's own ping
 * detects dead clients; the heartbeat + sweeper below covers a dead server.
 * An HTTP request never counts as presence.
 */
@Injectable()
export class PresenceService implements OnModuleDestroy {
  private readonly logger = new Logger(PresenceService.name);
  private readonly instanceId = randomUUID();
  /** Sockets held by this process. */
  private readonly localSockets = new Set<string>();

  constructor(
    @InjectModel(PresenceSession.name)
    private readonly sessionModel: Model<PresenceSession>,
    @InjectModel(UserSchemaName)
    private readonly userModel: Model<AvailabilityDoc>,
    private readonly emitter: EventEmitter2,
  ) {}

  async connected(userId: string, socketId: string): Promise<void> {
    this.localSockets.add(socketId);
    await this.sessionModel
      .updateOne(
        { socketId },
        {
          user: toObjectId(userId),
          socketId,
          instanceId: this.instanceId,
          lastSeenAt: new Date(),
        },
        { upsert: true },
      )
      .exec();
    await this.announce(userId);
  }

  async disconnected(userId: string, socketId: string): Promise<void> {
    this.localSockets.delete(socketId);
    await this.sessionModel.deleteOne({ socketId }).exec();
    if (!(await this.isConnected(userId))) await this.announce(userId);
  }

  async availability(userId: string): Promise<Availability> {
    const user = await this.userModel
      .findById(userId)
      .select('availability')
      .lean<AvailabilityDoc>()
      .exec();
    return user?.availability ?? 'ONLINE';
  }

  async setAvailability(
    userId: string,
    availability: Availability,
  ): Promise<{ availability: Availability; online: boolean }> {
    await this.userModel
      .updateOne({ _id: toObjectId(userId) }, { availability })
      .exec();
    const online = await this.announce(userId);
    return { availability, online };
  }

  /** At least one fresh socket, whatever the user's chosen availability. */
  async isConnected(userId: string): Promise<boolean> {
    return Boolean(
      await this.sessionModel.exists({
        user: toObjectId(userId),
        lastSeenAt: { $gt: this.staleBefore() },
      }),
    );
  }

  /** What other users see: connected AND not appearing offline. */
  async onlineUserIds(
    userIds: Array<string | Types.ObjectId>,
  ): Promise<Set<string>> {
    if (!userIds.length) return new Set();
    const connected: Types.ObjectId[] = await this.sessionModel
      .find({
        user: { $in: userIds.map(toObjectId) },
        lastSeenAt: { $gt: this.staleBefore() },
      })
      .distinct('user')
      .exec();
    if (!connected.length) return new Set();
    const hidden = await this.userModel
      .find({ _id: { $in: connected }, availability: 'OFFLINE' })
      .select('_id')
      .lean<AvailabilityDoc[]>()
      .exec();
    const hiddenIds = new Set(hidden.map((u) => String(u._id)));
    return new Set(connected.map(String).filter((id) => !hiddenIds.has(id)));
  }

  async isOnline(userId: string): Promise<boolean> {
    return (await this.onlineUserIds([userId])).has(userId);
  }

  @Interval(PRESENCE_HEARTBEAT_MS)
  async heartbeat(): Promise<void> {
    if (!this.localSockets.size) return;
    try {
      await this.sessionModel
        .updateMany(
          { socketId: { $in: [...this.localSockets] } },
          { lastSeenAt: new Date() },
        )
        .exec();
    } catch (error) {
      this.logger.warn(`Presence heartbeat failed: ${String(error)}`);
    }
  }

  /** Removes sessions nobody vouched for (crashed instance) and announces who went offline. */
  @Interval(PRESENCE_HEARTBEAT_MS)
  async sweep(now = new Date()): Promise<number> {
    try {
      const staleBefore = new Date(now.getTime() - PRESENCE_STALE_MS);
      const stale = await this.sessionModel
        .find({ lastSeenAt: { $lte: staleBefore } })
        .select('user socketId')
        .lean()
        .exec();
      if (!stale.length) return 0;
      await this.sessionModel
        .deleteMany({ socketId: { $in: stale.map((s) => s.socketId) } })
        .exec();
      const users = [...new Set(stale.map((s) => String(s.user)))];
      for (const userId of users) {
        if (!(await this.isConnected(userId))) await this.announce(userId);
      }
      return stale.length;
    } catch (error) {
      this.logger.warn(`Presence sweep failed: ${String(error)}`);
      return 0;
    }
  }

  /** On shutdown, drop this instance's sessions instead of waiting for the sweeper. */
  async onModuleDestroy(): Promise<void> {
    if (!this.localSockets.size) return;
    await this.sessionModel
      .deleteMany({ instanceId: this.instanceId })
      .exec()
      .catch(() => undefined);
  }

  /**
   * Publishes the user's current effective presence. Idempotent for clients,
   * so announcing an unchanged state (e.g. a second device) is harmless.
   */
  private async announce(userId: string): Promise<boolean> {
    const online = await this.isOnline(userId);
    const event: PresenceChangedEvent = { userId, online };
    this.emitter.emit(PRESENCE_CHANGED, event);
    return online;
  }

  private staleBefore(): Date {
    return new Date(Date.now() - PRESENCE_STALE_MS);
  }
}
