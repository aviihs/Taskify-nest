import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import {
  NOTIFICATION_CREATED,
  NotificationCreatedEvent,
} from '../common/events/domain-events';
import { paginate, Paginated } from '../common/pagination/pagination';
import { toObjectId } from '../common/utils/query';
import { PUBLIC_USER_SELECT } from '../users/public-user';
import { ListNotificationsQueryDto } from './dtos/notification.dto';
import {
  Notification,
  NotificationRecord,
  NotificationType,
} from './schemas/user-notification.schema';

export interface NotifyInput {
  recipientIds: string[];
  type: NotificationType;
  message: string;
  actorId?: string | null;
  workspaceId?: string | null;
  entityType: string;
  entityId: string;
  link?: string | null;
}

/**
 * Single entry point for creating notifications. Persists in-app
 * notifications and emits NOTIFICATION_CREATED so delivery channels
 * (websocket today; push/email later) can fan out without coupling.
 */
@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,
    private readonly emitter: EventEmitter2,
  ) {}

  async notify(input: NotifyInput): Promise<void> {
    const recipients = [...new Set(input.recipientIds)].filter(
      (id) => id !== input.actorId,
    );
    if (!recipients.length) return;

    const created = await this.notificationModel.insertMany(
      recipients.map((recipientId) => ({
        recipient: toObjectId(recipientId),
        type: input.type,
        message: input.message,
        actor: input.actorId ? toObjectId(input.actorId) : null,
        workspace: input.workspaceId ? toObjectId(input.workspaceId) : null,
        entityType: input.entityType,
        entityId: toObjectId(input.entityId),
        link: input.link ?? null,
      })),
    );
    for (const notification of created) {
      const event: NotificationCreatedEvent = {
        recipientId: String(notification.recipient),
        notificationId: String(notification._id),
      };
      this.emitter.emit(NOTIFICATION_CREATED, event);
    }
  }

  list(
    userId: string,
    query: ListNotificationsQueryDto,
  ): Promise<Paginated<NotificationRecord>> {
    const filter: FilterQuery<Notification> = { recipient: toObjectId(userId) };
    if (query.unreadOnly) filter.readAt = null;
    return paginate(this.notificationModel, filter, query, {
      populate: { path: 'actor', select: PUBLIC_USER_SELECT },
    }) as Promise<Paginated<NotificationRecord>>;
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.notificationModel
      .countDocuments({ recipient: toObjectId(userId), readAt: null })
      .exec();
    return { count };
  }

  async markRead(
    userId: string,
    notificationId: string,
  ): Promise<NotificationRecord> {
    const notification = await this.notificationModel
      .findOneAndUpdate(
        // Scoped by recipient: users can only touch their own notifications.
        { _id: notificationId, recipient: toObjectId(userId) },
        [{ $set: { readAt: { $ifNull: ['$readAt', new Date()] } } }],
        { new: true },
      )
      .lean<NotificationRecord>()
      .exec();
    if (!notification) throw new NotFoundException('Notification not found');
    return notification;
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.notificationModel
      .updateMany(
        { recipient: toObjectId(userId), readAt: null },
        { readAt: new Date() },
      )
      .exec();
    return { updated: result.modifiedCount };
  }
}
