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
import { ProjectAccessService } from '../projects/project-access.service';
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
  /**
   * When the notification is about something inside a project, recipients who
   * can no longer see that project are dropped.
   */
  projectId?: string | null;
  entityType: string;
  entityId: string;
  link?: string | null;
}

/**
 * Single entry point for creating notifications. Persists in-app
 * notifications and emits NOTIFICATION_CREATED so delivery channels
 * (websocket, push) can fan out without coupling.
 */
@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,
    private readonly emitter: EventEmitter2,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  /** Returns how many notifications were created. */
  async notify(input: NotifyInput): Promise<number> {
    let recipients = [...new Set(input.recipientIds)].filter(
      (id) => id !== input.actorId,
    );
    if (recipients.length && input.projectId) {
      const allowed = await this.projectAccess.usersWithAccess(
        input.projectId,
        recipients,
      );
      recipients = recipients.filter((id) => allowed.has(id));
    }
    if (!recipients.length) return 0;

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
        type: notification.type,
        message: notification.message,
        entityType: notification.entityType,
        entityId: String(notification.entityId),
        link: notification.link,
      };
      this.emitter.emit(NOTIFICATION_CREATED, event);
    }
    return created.length;
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

  /** Scoped by recipient: users can only delete their own notifications. */
  async remove(userId: string, notificationId: string): Promise<void> {
    const result = await this.notificationModel
      .deleteOne({ _id: notificationId, recipient: toObjectId(userId) })
      .exec();
    if (!result.deletedCount) {
      throw new NotFoundException('Notification not found');
    }
  }

  /** Clears the inbox; with `readOnly` keeps unread ones. */
  async removeAll(
    userId: string,
    readOnly = false,
  ): Promise<{ deleted: number }> {
    const filter: FilterQuery<Notification> = {
      recipient: toObjectId(userId),
    };
    if (readOnly) filter.readAt = { $ne: null };
    const result = await this.notificationModel.deleteMany(filter).exec();
    return { deleted: result.deletedCount };
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
