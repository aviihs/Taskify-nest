import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model } from 'mongoose';
import { canManageRole, Permission } from '../common/authorization/permissions';
import { TransactionRunner } from '../common/database/transaction-runner';
import { DomainEventPublisher } from '../common/events/domain-event-publisher';
import { paginate, Paginated } from '../common/pagination/pagination';
import { isDuplicateKeyError } from '../common/utils/mongo-errors';
import { PUBLIC_USER_SELECT, PublicUser } from '../users/public-user';
import { UsersService } from '../users/users.service';
import { MemberStatus } from '../workspaces/schemas/workspace-member.schema';
import { WorkspaceType } from '../workspaces/schemas/workspace.schema';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';
import { WorkspaceMembersService } from '../workspaces/workspace-members.service';
import {
  CreateInvitationDto,
  InviteeSearchQueryDto,
  InviteeStatus,
  ListInvitationsQueryDto,
} from './dtos/invitation.dto';
import {
  InvitationRecord,
  InvitationStatus,
  WorkspaceInvitation,
} from './schemas/invitation.schema';
import { displayName } from '../users/display-name';

export const INVITATION_TTL_DAYS = 7;
const INVITEE_SEARCH_LIMIT = 5;

export type InviteeCandidate = PublicUser & { inviteStatus: InviteeStatus };

@Injectable()
export class InvitationsService {
  constructor(
    @InjectModel(WorkspaceInvitation.name)
    private readonly invitationModel: Model<WorkspaceInvitation>,
    private readonly access: WorkspaceAccessService,
    private readonly members: WorkspaceMembersService,
    private readonly users: UsersService,
    private readonly events: DomainEventPublisher,
    private readonly tx: TransactionRunner,
  ) {}

  async create(
    actorId: string,
    workspaceId: string,
    dto: CreateInvitationDto,
  ): Promise<InvitationRecord> {
    const access = await this.access.authorize(
      actorId,
      workspaceId,
      Permission.MEMBER_INVITE,
    );
    if (access.workspace.type === WorkspaceType.PERSONAL) {
      throw new BadRequestException(
        'Invitations are only available for organization workspaces',
      );
    }
    if (!canManageRole(access.member.role, dto.role)) {
      throw new ForbiddenException('You cannot invite someone with this role');
    }

    const [invitee, inviter] = await Promise.all([
      this.findInvitee(dto),
      this.users.findById(actorId),
    ]);
    const email = invitee?.email ?? dto.email;
    const existing =
      invitee &&
      (await this.access.membershipOf(access.workspace._id, invitee._id));
    if (existing) {
      throw new ConflictException(
        existing.status === MemberStatus.SUSPENDED
          ? 'User is a suspended member of this workspace; reactivate them instead'
          : 'User is already a member of this workspace',
      );
    }

    // Free the unique "one pending invite" slot if the previous one lapsed.
    await this.expireStale({ workspace: access.workspace._id, email });

    let invitation: InvitationRecord;
    try {
      const created = await this.invitationModel.create({
        workspace: access.workspace._id,
        email,
        role: dto.role,
        invitedBy: actorId,
        invitee: invitee?._id ?? null,
        expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000),
      });
      invitation = created.toObject() as InvitationRecord;
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(
          'This person already has a pending invitation',
        );
      }
      throw error;
    }

    this.events.publish({
      type: 'invitation.created',
      actorId,
      workspaceId,
      entityId: String(invitation._id),
      email: invitation.email,
      role: invitation.role,
      workspaceName: access.workspace.name,
      inviterName: inviter ? displayName(inviter, 'A teammate') : 'A teammate',
      inviteeUserId: invitee ? String(invitee._id) : null,
    });
    return invitation;
  }

  async listForWorkspace(
    actorId: string,
    workspaceId: string,
    query: ListInvitationsQueryDto,
  ): Promise<Paginated<InvitationRecord>> {
    const { workspace } = await this.access.authorize(
      actorId,
      workspaceId,
      Permission.MEMBER_INVITE,
    );
    await this.expireStale({ workspace: workspace._id });

    return paginate(
      this.invitationModel,
      {
        workspace: workspace._id,
        ...(query.status && { status: query.status }),
      },
      query,
      {
        populate: [
          { path: 'invitedBy', select: PUBLIC_USER_SELECT },
          { path: 'invitee', select: PUBLIC_USER_SELECT },
        ],
      },
    ) as Promise<Paginated<InvitationRecord>>;
  }

  /** Username/name search for the invite picker, flagged with each person's status here. */
  async searchInvitees(
    actorId: string,
    workspaceId: string,
    query: InviteeSearchQueryDto,
  ): Promise<InviteeCandidate[]> {
    const { workspace } = await this.access.authorize(
      actorId,
      workspaceId,
      Permission.MEMBER_INVITE,
    );
    const users = await this.users.searchByUserName(
      query.q,
      INVITEE_SEARCH_LIMIT,
      actorId,
    );
    if (!users.length) return [];

    await this.expireStale({ workspace: workspace._id });
    const [memberIds, pending] = await Promise.all([
      this.access.coMemberIds([workspace._id]),
      this.invitationModel
        .find({
          workspace: workspace._id,
          status: InvitationStatus.PENDING,
          email: { $in: users.map((u) => u.email) },
        })
        .select('email')
        .lean<InvitationRecord[]>()
        .exec(),
    ]);
    const members = new Set(memberIds.map(String));
    const invited = new Set(pending.map((i) => i.email));

    return users.map((user) => ({
      ...user,
      inviteStatus: members.has(String(user._id))
        ? InviteeStatus.MEMBER
        : invited.has(user.email)
        ? InviteeStatus.INVITED
        : InviteeStatus.AVAILABLE,
    }));
  }

  async cancel(
    actorId: string,
    workspaceId: string,
    invitationId: string,
  ): Promise<void> {
    const { workspace, member } = await this.access.authorize(
      actorId,
      workspaceId,
      Permission.MEMBER_INVITE,
    );
    const pending = await this.invitationModel
      .findOne({
        _id: invitationId,
        workspace: workspace._id,
        status: InvitationStatus.PENDING,
      })
      .select('role')
      .lean<InvitationRecord>()
      .exec();
    if (pending && !canManageRole(member.role, pending.role)) {
      throw new ForbiddenException(
        'You cannot cancel an invitation for this role',
      );
    }
    const cancelled = await this.invitationModel
      .findOneAndUpdate(
        {
          _id: invitationId,
          workspace: workspace._id,
          status: InvitationStatus.PENDING,
        },
        { status: InvitationStatus.CANCELLED, respondedAt: new Date() },
        { new: true },
      )
      .lean<InvitationRecord>()
      .exec();
    if (!cancelled) {
      throw new NotFoundException('Pending invitation not found');
    }
    const invitee = await this.users.findByEmail(cancelled.email);
    this.publishClosed('invitation.cancelled', actorId, cancelled, invitee);
  }

  /** Pending invitations addressed to the caller's (verified) email. */
  async listMine(userId: string): Promise<InvitationRecord[]> {
    const email = await this.emailOf(userId);
    await this.expireStale({ email });
    return this.invitationModel
      .find({ email, status: InvitationStatus.PENDING })
      .sort({ createdAt: -1 })
      .populate({ path: 'workspace', select: 'name avatar type' })
      .populate({ path: 'invitedBy', select: PUBLIC_USER_SELECT })
      .lean<InvitationRecord[]>()
      .exec();
  }

  async accept(userId: string, invitationId: string) {
    const email = await this.emailOf(userId);
    // Claim + membership commit together: a failed insert leaves the
    // invitation PENDING instead of spent.
    const outcome = await this.tx.run(async (session) => {
      const invitation = await this.claimPending(
        email,
        invitationId,
        InvitationStatus.ACCEPTED,
        session,
      );
      if (!invitation) return null;
      if (!(await this.access.workspaceExists(invitation.workspace, session))) {
        await this.invitationModel
          .updateOne(
            { _id: invitation._id },
            { status: InvitationStatus.CANCELLED },
            { session },
          )
          .exec();
        return { invitation, member: null };
      }
      const member = await this.members.addMember(
        invitation.workspace,
        userId,
        invitation.role,
        String(invitation.invitedBy),
        session,
      );
      return { invitation, member };
    });

    if (!outcome) return this.rejectUnclaimable(email, invitationId);
    if (!outcome.member) {
      throw new GoneException('This invitation is no longer valid');
    }
    this.events.publish({
      type: 'workspace.member.joined',
      actorId: userId,
      workspaceId: String(outcome.invitation.workspace),
      entityId: String(outcome.member._id),
      userId,
      role: outcome.member.role,
    });
    return outcome.member;
  }

  async decline(userId: string, invitationId: string): Promise<void> {
    const email = await this.emailOf(userId);
    const declined = await this.claimPending(
      email,
      invitationId,
      InvitationStatus.DECLINED,
    );
    if (!declined) return this.rejectUnclaimable(email, invitationId);
    this.publishClosed('invitation.declined', userId, declined, {
      _id: userId,
    });
  }

  /** Lets both sides (inviter's workspace, invitee's app) refresh live. */
  private publishClosed(
    type: 'invitation.declined' | 'invitation.cancelled',
    actorId: string,
    invitation: InvitationRecord,
    invitee: { _id: unknown } | null,
  ): void {
    this.events.publish({
      type,
      actorId,
      workspaceId: String(invitation.workspace),
      entityId: String(invitation._id),
      email: invitation.email,
      inviteeUserId: invitee ? String(invitee._id) : null,
    });
  }

  /**
   * Atomically moves a pending, unexpired invitation addressed to `email`
   * into its final state, so double-accepts and races cannot create two
   * memberships or resurrect an answered invite. Null when nothing matched.
   */
  private claimPending(
    email: string,
    invitationId: string,
    status: InvitationStatus.ACCEPTED | InvitationStatus.DECLINED,
    session?: ClientSession,
  ): Promise<InvitationRecord | null> {
    const now = new Date();
    return this.invitationModel
      .findOneAndUpdate(
        {
          _id: invitationId,
          email,
          status: InvitationStatus.PENDING,
          expiresAt: { $gt: now },
        },
        { status, respondedAt: now },
        { new: true, session },
      )
      .lean<InvitationRecord>()
      .exec();
  }

  /** Explains why an invitation could not be claimed (and expires it if it lapsed). */
  private async rejectUnclaimable(
    email: string,
    invitationId: string,
  ): Promise<never> {
    const existing = await this.invitationModel
      .findOne({ _id: invitationId, email })
      .lean<InvitationRecord>()
      .exec();
    if (!existing) throw new NotFoundException('Invitation not found');
    if (
      existing.status === InvitationStatus.PENDING ||
      existing.status === InvitationStatus.EXPIRED
    ) {
      await this.expireStale({ _id: existing._id });
      throw new GoneException('This invitation has expired');
    }
    throw new ConflictException(
      `This invitation was already ${existing.status.toLowerCase()}`,
    );
  }

  private async expireStale(
    filter: FilterQuery<WorkspaceInvitation>,
  ): Promise<void> {
    await this.invitationModel
      .updateMany(
        {
          ...filter,
          status: InvitationStatus.PENDING,
          expiresAt: { $lte: new Date() },
        },
        { status: InvitationStatus.EXPIRED },
      )
      .exec();
  }

  private async findInvitee(dto: CreateInvitationDto) {
    if (dto.email !== undefined && dto.userName !== undefined) {
      throw new BadRequestException(
        'Provide either email or userName, not both',
      );
    }
    if (dto.userName === undefined) return this.users.findByEmail(dto.email);

    const user = await this.users.findByUserName(dto.userName);
    if (!user || !user.isActive) {
      throw new NotFoundException(
        `No user found with username "${dto.userName}"`,
      );
    }
    return user;
  }

  private async emailOf(userId: string): Promise<string> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    return user.email;
  }
}
