import { Injectable } from '@nestjs/common';
import { OnDomainEvent } from '../common/events/on-domain-event.decorator';
import { PushService } from '../notifications/push/push.service';
import { CHAT_MESSAGE_CREATED, ChatMessageCreatedEvent } from './chat-events';
import { PresenceService } from './presence.service';

const PUSH_PREVIEW_LENGTH = 120;

/**
 * Sends a chat message to the recipient's phones through the existing FCM
 * channel, but only when none of their devices holds a live socket — an open
 * app already received it in real time. Chat has its own unread counts, so it
 * does not add records to the notification Inbox.
 */
@Injectable()
export class ChatPushListener {
  constructor(
    private readonly push: PushService,
    private readonly presence: PresenceService,
  ) {}

  @OnDomainEvent(CHAT_MESSAGE_CREATED)
  async onMessage(event: ChatMessageCreatedEvent): Promise<void> {
    if (!this.push.enabled) return;
    const { sender, message } = event;
    const name = `${sender.firstName} ${sender.lastName}`.trim();
    const title = event.conversationName
      ? `${name || 'Someone'} · ${event.conversationName}`
      : name;
    const body =
      message.body.length > PUSH_PREVIEW_LENGTH
        ? `${message.body.slice(0, PUSH_PREVIEW_LENGTH - 1)}…`
        : message.body;

    for (const recipientId of event.memberIds) {
      if (recipientId === message.senderId) continue;
      if (await this.presence.isConnected(recipientId)) continue;
      await this.push.sendToUser(recipientId, {
        title: title || 'New message',
        body,
        data: {
          notificationId: '',
          type: 'CHAT_MESSAGE',
          entityType: 'conversation',
          entityId: message.conversationId,
          link: `/chat/${message.conversationId}`,
        },
      });
    }
  }
}
