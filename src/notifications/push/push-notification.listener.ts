import { Injectable } from '@nestjs/common';
import {
  NOTIFICATION_CREATED,
  NotificationCreatedEvent,
} from '../../common/events/domain-events';
import { OnDomainEvent } from '../../common/events/on-domain-event.decorator';
import { NotificationType } from '../schemas/user-notification.schema';
import { PushService } from './push.service';

const TITLES: Record<NotificationType, string> = {
  [NotificationType.TASK_ASSIGNED]: 'New task assigned',
  [NotificationType.TASK_STATUS_CHANGED]: 'Task status updated',
  [NotificationType.TASK_DUE_SOON]: 'Task due soon',
  [NotificationType.COMMENT_ADDED]: 'New comment',
  [NotificationType.MENTIONED]: 'You were mentioned',
  [NotificationType.WORKSPACE_INVITATION]: 'Workspace invitation',
  [NotificationType.PROJECT_MEMBER_ADDED]: 'Added to project',
  [NotificationType.NOTE_REMINDER]: 'Note reminder',
};

/** Mirrors every in-app notification to the recipient's phones. */
@Injectable()
export class PushNotificationListener {
  constructor(private readonly push: PushService) {}

  @OnDomainEvent(NOTIFICATION_CREATED)
  async onNotificationCreated(event: NotificationCreatedEvent): Promise<void> {
    if (!this.push.enabled) return;
    await this.push.sendToUser(event.recipientId, {
      title: TITLES[event.type as NotificationType] ?? 'Taskify',
      body: event.message,
      data: {
        notificationId: event.notificationId,
        type: event.type,
        entityType: event.entityType,
        entityId: event.entityId,
        link: event.link ?? '',
      },
    });
  }
}
