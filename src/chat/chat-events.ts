/**
 * Chat events published on the in-process bus for transports (websocket,
 * push). Not domain events: they never reach the activity log.
 */

/** Public profile fields shared in chat — deliberately without email. */
export interface ChatUser {
  _id: string;
  firstName: string;
  lastName: string;
  userName: string;
  avatar: string | null;
}

export interface ChatMessageView {
  _id: string;
  conversationId: string;
  senderId: string;
  body: string;
  seq: number;
  createdAt: Date;
  /** Only on the sender's copy, so their device can match its pending send. */
  clientId?: string | null;
}

export const CHAT_MESSAGE_CREATED = 'chat.message.created';
export interface ChatMessageCreatedEvent {
  /** Every participant, the sender included (their other devices sync too). */
  memberIds: string[];
  sender: ChatUser;
  message: ChatMessageView;
}

export const CHAT_READ = 'chat.read';
export interface ChatReadEvent {
  memberIds: string[];
  conversationId: string;
  userId: string;
  lastReadSeq: number;
}

export const PRESENCE_CHANGED = 'chat.presence.changed';
export interface PresenceChangedEvent {
  userId: string;
  online: boolean;
}
