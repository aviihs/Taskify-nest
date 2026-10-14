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
  forwarded: boolean;
  /** Deleted for everyone: `body` is empty. */
  deleted: boolean;
}

export const CHAT_MESSAGE_CREATED = 'chat.message.created';
export interface ChatMessageCreatedEvent {
  /** Every participant, the sender included (their other devices sync too). */
  memberIds: string[];
  sender: ChatUser;
  /** Group name; null for direct messages. */
  conversationName: string | null;
  message: ChatMessageView;
}

export const CHAT_READ = 'chat.read';
export interface ChatReadEvent {
  memberIds: string[];
  conversationId: string;
  userId: string;
  lastReadSeq: number;
}

export const CHAT_MESSAGES_DELETED = 'chat.messages.deleted';
/**
 * Messages deleted, or a whole chat cleared. Deleting for everyone goes to
 * every participant; deleting for me (and clearing) only to my own devices.
 */
export interface ChatMessagesDeletedEvent {
  memberIds: string[];
  conversationId: string;
  messageIds: string[];
  forEveryone: boolean;
  /** The whole chat was cleared for these members. */
  cleared: boolean;
}

export const CHAT_CONVERSATION_CREATED = 'chat.conversation.created';
/** A group was created; its members' inboxes changed. */
export interface ChatConversationCreatedEvent {
  memberIds: string[];
  conversationId: string;
}

export const PRESENCE_CHANGED = 'chat.presence.changed';
export interface PresenceChangedEvent {
  userId: string;
  online: boolean;
}
