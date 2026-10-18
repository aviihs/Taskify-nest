import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { isDuplicateKeyError } from '../common/utils/mongo-errors';
import { containsInsensitive, toObjectId } from '../common/utils/query';
import { UserSchemaName } from '../users/schemas/user.schema';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';
import {
  MemberStatus,
  WorkspaceMember,
  WorkspaceMemberRecord,
} from '../workspaces/schemas/workspace-member.schema';
import {
  Workspace,
  WorkspaceRecord,
} from '../workspaces/schemas/workspace.schema';
import {
  CHAT_CONVERSATION_CREATED,
  CHAT_MESSAGE_CREATED,
  CHAT_MESSAGES_DELETED,
  CHAT_READ,
  ChatConversationCreatedEvent,
  ChatMessageCreatedEvent,
  ChatMessagesDeletedEvent,
  ChatMessageView,
  ChatReadEvent,
  ChatUser,
} from './chat-events';
import {
  ContactsQueryDto,
  CreateGroupDto,
  DeleteMessagesDto,
  ListConversationsQueryDto,
  ListMessagesQueryDto,
  OpenDirectConversationDto,
  SendMessageDto,
  WorkspaceFilterDto,
} from './dtos/chat.dto';
import { PresenceService } from './presence.service';
import { ChatMessage, ChatMessageRecord } from './schemas/chat-message.schema';
import {
  Conversation,
  ConversationRecord,
  ConversationType,
} from './schemas/conversation.schema';
import { displayName } from '../users/display-name';

const CHAT_USER_FIELDS = {
  firstName: 1,
  lastName: 1,
  userName: 1,
  avatar: 1,
} as const;
const PREVIEW_LENGTH = 140;
/** Inbox preview of a last message deleted for everyone. */
export const DELETED_PREVIEW = 'Message deleted';
const MAX_CONTACTS = 200;

interface ChatUserDoc {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
  userName: string;
  avatar: string | null;
}

export interface ConversationView {
  _id: string;
  type: ConversationType;
  workspace: { _id: string; name: string };
  /**
   * DM: the other person. Group: a stand-in carrying the group's name (id is
   * the conversation's), so DM-only clients still have something to show.
   */
  peer: ChatUser & { online: boolean };
  /** Group name; null for DMs. */
  name: string | null;
  /** Everyone else in the chat, with presence. */
  members: Array<ChatUser & { online: boolean }>;
  lastMessage: {
    _id: string;
    senderId: string;
    preview: string;
    seq: number;
    createdAt: Date;
  } | null;
  lastMessageAt: Date | null;
  lastSeq: number;
  /** How far I have read. */
  lastReadSeq: number;
  /** How far the other person (in a group: everyone else) has read — drives "Read" receipts. */
  peerLastReadSeq: number;
  unreadCount: number;
  /** DM: false when the other person left the workspace: history stays, sending stops. */
  canSend: boolean;
}

export interface ContactView {
  user: ChatUser & { online: boolean };
  conversationId: string | null;
}

/**
 * Removes control characters (keeping newlines and tabs) and trims. Message
 * text is stored and returned as plain text; clients never render markup.
 */
export function normalizeMessageBody(raw: string): string {
  return (
    raw
      .replace(/\r\n?/g, '\n')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim()
  );
}

export function directKeyOf(workspaceId: string, a: string, b: string): string {
  return [workspaceId, ...[a, b].sort()].join(':');
}

/**
 * Direct messages between members of a workspace. Every read and write
 * re-checks, server-side, that the caller is a participant and still an
 * active member of the conversation's workspace; otherwise the conversation
 * is reported as not found, so its existence is not leaked.
 */
@Injectable()
export class ChatService {
  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<Conversation>,
    @InjectModel(ChatMessage.name)
    private readonly messageModel: Model<ChatMessage>,
    @InjectModel(WorkspaceMember.name)
    private readonly memberModel: Model<WorkspaceMember>,
    @InjectModel(Workspace.name)
    private readonly workspaceModel: Model<Workspace>,
    @InjectModel(UserSchemaName)
    private readonly userModel: Model<ChatUserDoc>,
    private readonly workspaceAccess: WorkspaceAccessService,
    private readonly presence: PresenceService,
    private readonly emitter: EventEmitter2,
  ) {}

  // ---------------------------------------------------------------------------
  // Access
  // ---------------------------------------------------------------------------

  /** The conversation, if the user may read it. Throws 404 otherwise. */
  async authorize(
    userId: string,
    conversationId: string,
  ): Promise<ConversationRecord> {
    const conversation = Types.ObjectId.isValid(conversationId)
      ? await this.conversationModel
          .findOne({ _id: conversationId, 'members.user': toObjectId(userId) })
          .lean<ConversationRecord>()
          .exec()
      : null;
    if (
      !conversation ||
      !(await this.isLiveMember(conversation.workspace, userId))
    ) {
      throw new NotFoundException('Conversation not found');
    }
    return conversation;
  }

  /** Other participants of a conversation the user may access (for typing fan-out). */
  async peersOf(userId: string, conversationId: string): Promise<string[]> {
    const conversation = await this.authorize(userId, conversationId);
    return (await this.audience(conversation)).filter((id) => id !== userId);
  }

  /**
   * Who receives a conversation's live events: DM participants, or the group
   * members still active in the workspace (people who left get nothing).
   */
  private async audience(conversation: ConversationRecord): Promise<string[]> {
    const ids = this.memberIds(conversation);
    if (conversation.type !== ConversationType.GROUP) return ids;
    const active = await this.workspaceAccess.activeMembers(
      conversation.workspace,
      ids,
    );
    return active.map((m) => String(m.user));
  }

  // ---------------------------------------------------------------------------
  // Conversations
  // ---------------------------------------------------------------------------

  /** Finds or creates the one DM between two workspace members; safe under concurrency. */
  async openDirect(
    userId: string,
    dto: OpenDirectConversationDto,
  ): Promise<ConversationView> {
    if (dto.userId === userId) {
      throw new BadRequestException('You cannot message yourself');
    }
    await this.workspaceAccess.resolve(userId, dto.workspaceId);
    if (
      !(await this.workspaceAccess.isActiveMember(dto.workspaceId, dto.userId))
    ) {
      throw new NotFoundException('User not found in this workspace');
    }

    const directKey = directKeyOf(dto.workspaceId, userId, dto.userId);
    const insert = {
      workspace: toObjectId(dto.workspaceId),
      type: ConversationType.DIRECT,
      directKey,
      members: [userId, dto.userId].map((id) => ({
        user: toObjectId(id),
        lastReadSeq: 0,
      })),
      lastSeq: 0,
      lastMessage: null,
      lastMessageAt: null,
    };
    let conversation: ConversationRecord | null;
    try {
      conversation = await this.conversationModel
        .findOneAndUpdate(
          { directKey },
          { $setOnInsert: insert },
          { upsert: true, new: true },
        )
        .lean<ConversationRecord>()
        .exec();
    } catch (error) {
      // Two simultaneous upserts: the loser hits the unique key; read the winner.
      if (!isDuplicateKeyError(error)) throw error;
      conversation = await this.conversationModel
        .findOne({ directKey })
        .lean<ConversationRecord>()
        .exec();
    }
    if (!conversation) throw new NotFoundException('Conversation not found');
    const [view] = await this.toViews(userId, [conversation]);
    return view;
  }

  /** A named chat with two or more other members of one workspace. */
  async createGroup(
    userId: string,
    dto: CreateGroupDto,
  ): Promise<ConversationView> {
    await this.workspaceAccess.resolve(userId, dto.workspaceId);
    const others = [...new Set(dto.memberIds)].filter((id) => id !== userId);
    if (others.length < 2) {
      throw new BadRequestException('A group needs at least two other members');
    }
    const active = await this.workspaceAccess.activeMembers(
      dto.workspaceId,
      others,
    );
    if (active.length !== others.length) {
      throw new NotFoundException('User not found in this workspace');
    }
    const name = normalizeMessageBody(dto.name).replace(/\s+/g, ' ');
    if (!name) throw new BadRequestException('Group name cannot be empty');

    const now = new Date();
    const created = await this.conversationModel.create({
      workspace: toObjectId(dto.workspaceId),
      type: ConversationType.GROUP,
      directKey: `group:${new Types.ObjectId().toString()}`,
      name,
      createdBy: toObjectId(userId),
      members: [userId, ...others].map((id) => ({
        user: toObjectId(id),
        lastReadSeq: 0,
      })),
      lastSeq: 0,
      lastMessage: null,
      // In everyone's inbox right away, before the first message.
      lastMessageAt: now,
    });
    const conversation = created.toObject() as ConversationRecord;
    const event: ChatConversationCreatedEvent = {
      memberIds: this.memberIds(conversation),
      conversationId: String(conversation._id),
    };
    this.emitter.emit(CHAT_CONVERSATION_CREATED, event);
    const [view] = await this.toViews(userId, [conversation]);
    return view;
  }

  async get(userId: string, conversationId: string): Promise<ConversationView> {
    const conversation = await this.authorize(userId, conversationId);
    const [view] = await this.toViews(userId, [conversation]);
    return view;
  }

  /** My conversations with at least one message, newest activity first. */
  async list(
    userId: string,
    query: ListConversationsQueryDto,
  ): Promise<{ items: ConversationView[]; hasMore: boolean }> {
    const workspaceIds = await this.liveWorkspaceIds(userId, query);
    if (!workspaceIds.length) return { items: [], hasMore: false };

    const filter: FilterQuery<Conversation> = {
      members: this.visibleTo(userId),
      workspace: { $in: workspaceIds },
      lastMessageAt: query.before ? { $lt: query.before } : { $ne: null },
    };
    const rows = await this.conversationModel
      .find(filter)
      .sort({ lastMessageAt: -1, _id: -1 })
      .limit(query.limit + 1)
      .lean<ConversationRecord[]>()
      .exec();
    const hasMore = rows.length > query.limit;
    return {
      items: await this.toViews(userId, rows.slice(0, query.limit)),
      hasMore,
    };
  }

  /** Total unread messages across every conversation I can still access. */
  async unreadTotal(
    userId: string,
    query: WorkspaceFilterDto = {},
  ): Promise<{ count: number }> {
    const byWorkspace = await this.unreadByWorkspace(userId, query);
    return { count: byWorkspace.reduce((sum, w) => sum + w.count, 0) };
  }

  /** Unread messages per workspace; workspaces with none are left out. */
  async unreadByWorkspace(
    userId: string,
    query: WorkspaceFilterDto = {},
  ): Promise<Array<{ workspaceId: string; count: number }>> {
    const workspaceIds = await this.liveWorkspaceIds(userId, query);
    if (!workspaceIds.length) return [];
    const rows = await this.conversationModel
      .find({
        members: this.visibleTo(userId),
        workspace: { $in: workspaceIds },
        lastMessageAt: { $ne: null },
      })
      .select('workspace members lastSeq')
      .lean<ConversationRecord[]>()
      .exec();
    const unread = await this.unreadCounts(userId, rows);
    const counts = new Map<string, number>();
    for (const c of rows) {
      const n = unread.get(String(c._id));
      if (!n) continue;
      const workspaceId = String(c.workspace);
      counts.set(workspaceId, (counts.get(workspaceId) ?? 0) + n);
    }
    return [...counts].map(([workspaceId, count]) => ({ workspaceId, count }));
  }

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  /**
   * Latest page by default (ascending in the response); `before` pages
   * backwards; `after` catches up after a reconnect.
   */
  async messages(
    userId: string,
    conversationId: string,
    query: ListMessagesQueryDto,
  ): Promise<{ items: ChatMessageView[]; hasMore: boolean }> {
    const conversation = await this.authorize(userId, conversationId);
    if (query.before !== undefined && query.after !== undefined) {
      throw new BadRequestException('Use either before or after, not both');
    }

    const forward = query.after !== undefined;
    // Nothing from before I cleared the chat, nor what I deleted for myself.
    const seq: { $gt: number; $lt?: number } = {
      $gt: Math.max(
        this.memberOf(conversation, userId)?.clearedSeq ?? 0,
        query.after ?? 0,
      ),
    };
    if (query.before !== undefined) seq.$lt = query.before;
    const filter: FilterQuery<ChatMessage> = {
      conversation: conversation._id,
      seq,
      hiddenFor: { $ne: toObjectId(userId) },
    };

    const rows = await this.messageModel
      .find(filter)
      .sort({ seq: forward ? 1 : -1 })
      .limit(query.limit + 1)
      .lean<ChatMessageRecord[]>()
      .exec();
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    if (!forward) page.reverse();
    return {
      items: page.map((m) => this.toMessageView(m, userId)),
      hasMore,
    };
  }

  async send(
    userId: string,
    conversationId: string,
    dto: SendMessageDto,
  ): Promise<ChatMessageView> {
    const conversation = await this.authorize(userId, conversationId);
    const sender = toObjectId(userId);

    // A retry of a send that already succeeded: return it, don't duplicate.
    if (dto.clientId) {
      const existing = await this.findByClientId(sender, dto.clientId);
      if (existing) return this.retried(existing, conversation, userId);
    }

    const body = normalizeMessageBody(dto.body);
    if (!body) throw new BadRequestException('Message cannot be empty');

    const isGroup = conversation.type === ConversationType.GROUP;
    const memberIds = await this.audience(conversation);
    if (!isGroup) {
      const peers = memberIds.filter((id) => id !== userId);
      const activePeers = await this.workspaceAccess.activeMembers(
        conversation.workspace,
        peers,
      );
      if (activePeers.length !== peers.length) {
        throw new ForbiddenException(
          'This person is no longer a member of the workspace',
        );
      }
    } else if (memberIds.length < 2) {
      throw new ForbiddenException('Everyone else has left this group');
    }

    // Server-assigned order: an atomic counter per conversation.
    const numbered = await this.conversationModel
      .findOneAndUpdate(
        { _id: conversation._id },
        { $inc: { lastSeq: 1 } },
        { new: true },
      )
      .select('lastSeq')
      .lean<ConversationRecord>()
      .exec();
    if (!numbered) throw new NotFoundException('Conversation not found');
    const seq = numbered.lastSeq;

    let message: ChatMessageRecord;
    try {
      message = (
        await this.messageModel.create({
          conversation: conversation._id,
          workspace: conversation.workspace,
          sender,
          body,
          seq,
          clientId: dto.clientId ?? null,
          forwarded: dto.forwarded === true,
        })
      ).toObject() as ChatMessageRecord;
    } catch (error) {
      // The same clientId raced in twice; the first one won. (The skipped seq
      // is harmless: unread counts and paging count real messages.)
      if (dto.clientId && isDuplicateKeyError(error)) {
        const existing = await this.findByClientId(sender, dto.clientId);
        if (existing) return this.retried(existing, conversation, userId);
      }
      throw error;
    }

    await Promise.all([
      this.conversationModel
        .updateOne(
          {
            _id: conversation._id,
            $or: [{ lastMessage: null }, { 'lastMessage.seq': { $lt: seq } }],
          },
          {
            lastMessage: {
              id: message._id,
              sender,
              preview: body.slice(0, PREVIEW_LENGTH),
              seq,
              createdAt: message.createdAt,
            },
            lastMessageAt: message.createdAt,
          },
        )
        .exec(),
      // Sending means I have seen everything up to my own message.
      this.advanceRead(conversation._id, sender, seq),
      // A new message brings a deleted chat back to everyone's inbox.
      this.conversationModel
        .updateOne(
          { _id: conversation._id, 'members.hidden': true },
          { $set: { 'members.$[].hidden': false } },
        )
        .exec(),
    ]);

    const view = this.toMessageView(message, userId);
    const senderDoc = await this.userModel
      .findById(sender)
      .select(CHAT_USER_FIELDS)
      .lean<ChatUserDoc>()
      .exec();
    const event: ChatMessageCreatedEvent = {
      memberIds,
      sender: this.toChatUser(senderDoc, userId),
      conversationName: isGroup ? conversation.name : null,
      message: { ...view, clientId: dto.clientId ?? null },
    };
    this.emitter.emit(CHAT_MESSAGE_CREATED, event);
    return view;
  }

  /**
   * Marks messages up to `seq` as read. Never moves backwards and never past
   * the last real message, whatever the client sends.
   */
  async markRead(
    userId: string,
    conversationId: string,
    seq: number,
  ): Promise<{ lastReadSeq: number; unreadCount: number }> {
    const conversation = await this.authorize(userId, conversationId);
    const target = Math.min(seq, conversation.lastSeq);
    const me = toObjectId(userId);
    const before = this.readSeqOf(conversation, userId);
    if (target > before) {
      await this.advanceRead(conversation._id, me, target);
      const event: ChatReadEvent = {
        memberIds: await this.audience(conversation),
        conversationId: String(conversation._id),
        userId,
        lastReadSeq: target,
      };
      this.emitter.emit(CHAT_READ, event);
    }
    const lastReadSeq = Math.max(before, target);
    const unread = await this.unreadCounts(userId, [
      {
        ...conversation,
        members: conversation.members.map((m) =>
          String(m.user) === userId ? { ...m, lastReadSeq } : m,
        ),
      },
    ]);
    return {
      lastReadSeq,
      unreadCount: unread.get(String(conversation._id)) ?? 0,
    };
  }

  /**
   * Deletes messages. For everyone: only the caller's own messages; the body
   * is erased and a placeholder stays for both sides. For me: hidden from my
   * history only.
   */
  async deleteMessages(
    userId: string,
    conversationId: string,
    dto: DeleteMessagesDto,
  ): Promise<{ messageIds: string[]; forEveryone: boolean }> {
    const conversation = await this.authorize(userId, conversationId);
    const me = toObjectId(userId);
    const forEveryone = dto.forEveryone === true;
    const ids = [...new Set(dto.messageIds)].map(toObjectId);
    const found = await this.messageModel
      .find({ _id: { $in: ids }, conversation: conversation._id })
      .select('sender deletedAt')
      .lean<ChatMessageRecord[]>()
      .exec();
    if (found.length !== ids.length) {
      throw new NotFoundException('Message not found');
    }

    if (forEveryone) {
      if (found.some((m) => !m.sender.equals(me))) {
        throw new ForbiddenException(
          'You can only delete your own messages for everyone',
        );
      }
      await this.messageModel
        .updateMany(
          { _id: { $in: ids }, deletedAt: null },
          { $set: { deletedAt: new Date(), body: '' } },
        )
        .exec();
      const last = conversation.lastMessage;
      if (last && ids.some((id) => id.equals(last.id))) {
        await this.conversationModel
          .updateOne(
            { _id: conversation._id, 'lastMessage.id': last.id },
            { $set: { 'lastMessage.preview': DELETED_PREVIEW } },
          )
          .exec();
      }
    } else {
      await this.messageModel
        .updateMany({ _id: { $in: ids } }, { $addToSet: { hiddenFor: me } })
        .exec();
    }

    const messageIds = ids.map(String);
    const event: ChatMessagesDeletedEvent = {
      memberIds: forEveryone ? await this.audience(conversation) : [userId],
      conversationId: String(conversation._id),
      messageIds,
      forEveryone,
      cleared: false,
    };
    this.emitter.emit(CHAT_MESSAGES_DELETED, event);
    return { messageIds, forEveryone };
  }

  /**
   * "Delete chat": clears the history for me and drops the chat from my
   * inbox. The other person keeps theirs; a new message brings it back.
   */
  async clear(userId: string, conversationId: string): Promise<void> {
    const conversation = await this.authorize(userId, conversationId);
    const me = toObjectId(userId);
    const { lastSeq } = conversation;
    await this.conversationModel
      .updateOne(
        { _id: conversation._id },
        {
          $max: {
            'members.$[me].clearedSeq': lastSeq,
            'members.$[me].lastReadSeq': lastSeq,
          },
          $set: { 'members.$[me].hidden': true },
        },
        { arrayFilters: [{ 'me.user': me }] },
      )
      .exec();
    const event: ChatMessagesDeletedEvent = {
      memberIds: [userId],
      conversationId: String(conversation._id),
      messageIds: [],
      forEveryone: false,
      cleared: true,
    };
    this.emitter.emit(CHAT_MESSAGES_DELETED, event);
  }

  // ---------------------------------------------------------------------------
  // Contacts
  // ---------------------------------------------------------------------------

  /** Active members of a workspace I belong to, with presence and any existing DM. */
  async contacts(
    userId: string,
    query: ContactsQueryDto,
  ): Promise<ContactView[]> {
    await this.workspaceAccess.resolve(userId, query.workspaceId);
    const members = await this.memberModel
      .find({
        workspace: toObjectId(query.workspaceId),
        status: MemberStatus.ACTIVE,
        user: { $ne: toObjectId(userId) },
      })
      .select('user')
      .limit(MAX_CONTACTS * 2)
      .lean<WorkspaceMemberRecord[]>()
      .exec();
    if (!members.length) return [];

    const userFilter: FilterQuery<ChatUserDoc> = {
      _id: { $in: members.map((m) => m.user) },
      deletedAt: null,
    };
    if (query.q?.trim()) {
      const regex = containsInsensitive(query.q);
      userFilter.$or = [
        { firstName: regex },
        { lastName: regex },
        { userName: regex },
      ];
    }
    const users = await this.userModel
      .find(userFilter)
      .select(CHAT_USER_FIELDS)
      .limit(MAX_CONTACTS)
      .lean<ChatUserDoc[]>()
      .exec();
    if (!users.length) return [];

    const keys = users.map((u) =>
      directKeyOf(query.workspaceId, userId, String(u._id)),
    );
    const [online, existing] = await Promise.all([
      this.presence.onlineUserIds(users.map((u) => u._id)),
      this.conversationModel
        .find({ directKey: { $in: keys } })
        .select('directKey')
        .lean<ConversationRecord[]>()
        .exec(),
    ]);
    const byKey = new Map(existing.map((c) => [c.directKey, String(c._id)]));

    return users
      .map((u) => ({
        user: {
          ...this.toChatUser(u, String(u._id)),
          online: online.has(String(u._id)),
        },
        conversationId:
          byKey.get(directKeyOf(query.workspaceId, userId, String(u._id))) ??
          null,
      }))
      .sort(
        (a, b) =>
          Number(b.user.online) - Number(a.user.online) ||
          displayName(a.user).localeCompare(displayName(b.user)),
      );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async toViews(
    userId: string,
    conversations: ConversationRecord[],
  ): Promise<ConversationView[]> {
    if (!conversations.length) return [];
    const othersOf = (c: ConversationRecord) =>
      this.memberIds(c).filter((id) => id !== userId);
    const peerIds = conversations.map((c) => othersOf(c)[0] ?? userId);
    const everyone = [...new Set(conversations.flatMap(othersOf))];
    const workspaceIds = [
      ...new Set(conversations.map((c) => String(c.workspace))),
    ];

    const [users, workspaces, online, unread, activePeers] = await Promise.all([
      this.userModel
        .find({ _id: { $in: everyone.map(toObjectId) } })
        .select(CHAT_USER_FIELDS)
        .lean<ChatUserDoc[]>()
        .exec(),
      this.workspaceModel
        .find({ _id: { $in: workspaceIds.map(toObjectId) } })
        .select('name')
        .lean<WorkspaceRecord[]>()
        .exec(),
      this.presence.onlineUserIds(everyone),
      this.unreadCounts(userId, conversations),
      this.memberModel
        .find({
          workspace: { $in: workspaceIds.map(toObjectId) },
          user: { $in: everyone.map(toObjectId) },
          status: MemberStatus.ACTIVE,
        })
        .select('workspace user')
        .lean<WorkspaceMemberRecord[]>()
        .exec(),
    ]);
    const userById = new Map(users.map((u) => [String(u._id), u]));
    const workspaceById = new Map(workspaces.map((w) => [String(w._id), w]));
    const activeKeys = new Set(
      activePeers.map((m) => `${m.workspace}:${m.user}`),
    );

    const withPresence = (id: string) => ({
      ...this.toChatUser(userById.get(id) ?? null, id),
      online: online.has(id),
    });

    return conversations.map((c, i) => {
      const peerId = peerIds[i];
      const id = String(c._id);
      const isGroup = c.type === ConversationType.GROUP;
      const others = othersOf(c);
      const stillHere = others.filter((o) =>
        activeKeys.has(`${c.workspace}:${o}`),
      );
      return {
        _id: id,
        type: c.type,
        workspace: {
          _id: String(c.workspace),
          name: workspaceById.get(String(c.workspace))?.name ?? '',
        },
        peer: isGroup
          ? {
              _id: id,
              firstName: c.name ?? 'Group',
              lastName: '',
              userName: '',
              avatar: null,
              online: false,
            }
          : withPresence(peerId),
        name: isGroup ? c.name : null,
        members: (isGroup ? stillHere : others).map(withPresence),
        lastMessage: c.lastMessage
          ? {
              _id: String(c.lastMessage.id),
              senderId: String(c.lastMessage.sender),
              preview: c.lastMessage.preview,
              seq: c.lastMessage.seq,
              createdAt: c.lastMessage.createdAt,
            }
          : null,
        lastMessageAt: c.lastMessageAt,
        lastSeq: c.lastSeq,
        lastReadSeq: this.readSeqOf(c, userId),
        peerLastReadSeq: isGroup
          ? Math.min(...stillHere.map((o) => this.readSeqOf(c, o)), c.lastSeq)
          : this.readSeqOf(c, peerId),
        unreadCount: unread.get(id) ?? 0,
        canSend: isGroup
          ? stillHere.length > 0
          : activeKeys.has(`${c.workspace}:${peerId}`),
      };
    });
  }

  /** Messages from others after my read marker, per conversation, in one query. */
  private async unreadCounts(
    userId: string,
    conversations: Array<
      Pick<ConversationRecord, '_id' | 'members' | 'lastSeq'>
    >,
  ): Promise<Map<string, number>> {
    const pending = conversations
      .map((c) => ({
        id: c._id,
        read: this.readSeqOf(c, userId),
        last: c.lastSeq,
      }))
      .filter((c) => c.last > c.read);
    if (!pending.length) return new Map();
    const rows = await this.messageModel
      .aggregate<{ _id: Types.ObjectId; count: number }>([
        {
          $match: {
            $or: pending.map((c) => ({
              conversation: c.id,
              seq: { $gt: c.read },
            })),
            sender: { $ne: toObjectId(userId) },
          },
        },
        { $group: { _id: '$conversation', count: { $sum: 1 } } },
      ])
      .exec();
    return new Map(rows.map((r) => [String(r._id), r.count]));
  }

  private advanceRead(
    conversationId: Types.ObjectId,
    user: Types.ObjectId,
    seq: number,
  ) {
    return this.conversationModel
      .updateOne(
        { _id: conversationId },
        { $max: { 'members.$[me].lastReadSeq': seq } },
        { arrayFilters: [{ 'me.user': user }] },
      )
      .exec();
  }

  private async findByClientId(
    sender: Types.ObjectId,
    clientId: string,
  ): Promise<ChatMessageRecord | null> {
    return this.messageModel
      .findOne({ sender, clientId })
      .lean<ChatMessageRecord>()
      .exec();
  }

  private retried(
    existing: ChatMessageRecord,
    conversation: ConversationRecord,
    userId: string,
  ): ChatMessageView {
    if (!existing.conversation.equals(conversation._id)) {
      throw new BadRequestException(
        'clientId was already used for another conversation',
      );
    }
    return this.toMessageView(existing, userId);
  }

  /** Workspaces I'm still in; narrowed to one when the client asks. */
  private async liveWorkspaceIds(
    userId: string,
    filter: WorkspaceFilterDto = {},
  ): Promise<Types.ObjectId[]> {
    const ids = (await this.workspaceAccess.memberships(userId)).map(
      (m) => m.workspaceId,
    );
    return filter.workspaceId
      ? ids.filter((id) => String(id) === filter.workspaceId)
      : ids;
  }

  private async isLiveMember(
    workspaceId: Types.ObjectId,
    userId: string,
  ): Promise<boolean> {
    // Independent checks: one round trip instead of two.
    const [member, exists] = await Promise.all([
      this.workspaceAccess.isActiveMember(workspaceId, userId),
      this.workspaceAccess.workspaceExists(workspaceId),
    ]);
    return member && exists;
  }

  private memberIds(
    conversation: Pick<ConversationRecord, 'members'>,
  ): string[] {
    return conversation.members.map((m) => String(m.user));
  }

  private memberOf(
    conversation: Pick<ConversationRecord, 'members'>,
    userId: string,
  ) {
    return conversation.members.find((m) => String(m.user) === userId);
  }

  /** Matches conversations I'm in and haven't deleted. */
  private visibleTo(userId: string) {
    return { $elemMatch: { user: toObjectId(userId), hidden: { $ne: true } } };
  }

  private readSeqOf(
    conversation: Pick<ConversationRecord, 'members'>,
    userId: string,
  ): number {
    return (
      conversation.members.find((m) => String(m.user) === userId)
        ?.lastReadSeq ?? 0
    );
  }

  private toMessageView(
    m: ChatMessageRecord,
    viewerId: string,
  ): ChatMessageView {
    const senderId = String(m.sender);
    const deleted = m.deletedAt != null;
    return {
      _id: String(m._id),
      conversationId: String(m.conversation),
      senderId,
      body: deleted ? '' : m.body,
      seq: m.seq,
      createdAt: m.createdAt,
      forwarded: m.forwarded === true,
      deleted,
      ...(senderId === viewerId && { clientId: m.clientId }),
    };
  }

  private toChatUser(user: ChatUserDoc | null, id: string): ChatUser {
    return {
      _id: id,
      firstName: user?.firstName ?? 'Deleted',
      lastName: user?.lastName ?? 'user',
      userName: user?.userName ?? '',
      avatar: user?.avatar ?? null,
    };
  }
}
