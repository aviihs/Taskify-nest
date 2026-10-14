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
  CHAT_MESSAGE_CREATED,
  CHAT_READ,
  ChatMessageCreatedEvent,
  ChatMessageView,
  ChatReadEvent,
  ChatUser,
} from './chat-events';
import {
  ContactsQueryDto,
  ListConversationsQueryDto,
  ListMessagesQueryDto,
  OpenDirectConversationDto,
  SendMessageDto,
} from './dtos/chat.dto';
import { PresenceService } from './presence.service';
import { ChatMessage, ChatMessageRecord } from './schemas/chat-message.schema';
import {
  Conversation,
  ConversationRecord,
  ConversationType,
} from './schemas/conversation.schema';

const CHAT_USER_FIELDS = {
  firstName: 1,
  lastName: 1,
  userName: 1,
  avatar: 1,
} as const;
const PREVIEW_LENGTH = 140;
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
  peer: ChatUser & { online: boolean };
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
  /** How far the other person has read — drives "Read" receipts. */
  peerLastReadSeq: number;
  unreadCount: number;
  /** False when the other person left the workspace: history stays, sending stops. */
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
    return this.memberIds(conversation).filter((id) => id !== userId);
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
    const workspaceIds = await this.liveWorkspaceIds(userId);
    if (!workspaceIds.length) return { items: [], hasMore: false };

    const filter: FilterQuery<Conversation> = {
      'members.user': toObjectId(userId),
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
  async unreadTotal(userId: string): Promise<{ count: number }> {
    const workspaceIds = await this.liveWorkspaceIds(userId);
    if (!workspaceIds.length) return { count: 0 };
    const rows = await this.conversationModel
      .find({
        'members.user': toObjectId(userId),
        workspace: { $in: workspaceIds },
        lastMessageAt: { $ne: null },
      })
      .select('members lastSeq')
      .lean<ConversationRecord[]>()
      .exec();
    const unread = await this.unreadCounts(userId, rows);
    let count = 0;
    unread.forEach((n) => (count += n));
    return { count };
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
    const filter: FilterQuery<ChatMessage> = {
      conversation: conversation._id,
    };
    if (forward) filter.seq = { $gt: query.after };
    else if (query.before !== undefined) filter.seq = { $lt: query.before };

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

    const memberIds = this.memberIds(conversation);
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
        memberIds: this.memberIds(conversation),
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
    const peerIds = conversations.map(
      (c) => this.memberIds(c).find((id) => id !== userId) ?? userId,
    );
    const workspaceIds = [
      ...new Set(conversations.map((c) => String(c.workspace))),
    ];

    const [users, workspaces, online, unread, activePeers] = await Promise.all([
      this.userModel
        .find({ _id: { $in: peerIds.map(toObjectId) } })
        .select(CHAT_USER_FIELDS)
        .lean<ChatUserDoc[]>()
        .exec(),
      this.workspaceModel
        .find({ _id: { $in: workspaceIds.map(toObjectId) } })
        .select('name')
        .lean<WorkspaceRecord[]>()
        .exec(),
      this.presence.onlineUserIds(peerIds),
      this.unreadCounts(userId, conversations),
      this.memberModel
        .find({
          workspace: { $in: workspaceIds.map(toObjectId) },
          user: { $in: peerIds.map(toObjectId) },
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

    return conversations.map((c, i) => {
      const peerId = peerIds[i];
      const id = String(c._id);
      return {
        _id: id,
        type: c.type,
        workspace: {
          _id: String(c.workspace),
          name: workspaceById.get(String(c.workspace))?.name ?? '',
        },
        peer: {
          ...this.toChatUser(userById.get(peerId) ?? null, peerId),
          online: online.has(peerId),
        },
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
        peerLastReadSeq: this.readSeqOf(c, peerId),
        unreadCount: unread.get(id) ?? 0,
        canSend: activeKeys.has(`${c.workspace}:${peerId}`),
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

  private async liveWorkspaceIds(userId: string): Promise<Types.ObjectId[]> {
    return (await this.workspaceAccess.memberships(userId)).map(
      (m) => m.workspaceId,
    );
  }

  private async isLiveMember(
    workspaceId: Types.ObjectId,
    userId: string,
  ): Promise<boolean> {
    return (
      (await this.workspaceAccess.isActiveMember(workspaceId, userId)) &&
      (await this.workspaceAccess.workspaceExists(workspaceId))
    );
  }

  private memberIds(
    conversation: Pick<ConversationRecord, 'members'>,
  ): string[] {
    return conversation.members.map((m) => String(m.user));
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
    return {
      _id: String(m._id),
      conversationId: String(m.conversation),
      senderId,
      body: m.body,
      seq: m.seq,
      createdAt: m.createdAt,
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

function displayName(user: ChatUser): string {
  return `${user.firstName} ${user.lastName}`.trim() || user.userName;
}
