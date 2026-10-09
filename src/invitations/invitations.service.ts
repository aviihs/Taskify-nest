import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { canManageRole, Permission } from '../common/authorization/permissions';
import { DomainEventPublisher } from '../common/events/domain-event-publisher';
import { paginate, Paginated } from '../common/pagination/pagination';
import { isDuplicateKeyError } from '../common/utils/mongo-errors';
import { PUBLIC_USER_SELECT } from '../users/public-user';
import { UsersService } from '../users/users.service';
import { WorkspaceType } from '../workspaces/schemas/workspace.schema';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';
import { WorkspaceMembersService } from '../workspaces/workspace-members.service';
import {
  CreateInvitationDto,
  ListInvitationsQueryDto,
} from './dtos/invitation.dto';
import {
  InvitationRecord,
  InvitationStatus,
  WorkspaceInvitation,
} from './schemas/invitation.schema';

export const INVITATION_TTL_DAYS = 7;

@Injectable()
export class InvitationsService {
  constructor(
    @InjectModel(WorkspaceInvitation.name)
    private readonly invitationModel: Model<WorkspaceInvitation>,
    private readonly access: WorkspaceAccessService,
    private readonly members: WorkspaceMembersService,
    private readonly users: UsersService,
    private readonly events: DomainEventPublisher,
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
      this.users.findByEmail(dto.email),
      this.users.findById(actorId),
    ]);
    if (
      invitee &&
      (await this.access.isActiveMember(access.workspace._id, invitee._id))
    ) {
      throw new ConflictException('User is already a member of this workspace');
    }

    // Free the unique "one pending invite" slot if the previous one lapsed.
    await this.expireStale({
      workspace: access.workspace._id,
      email: dto.email,
    });

    let invitation: InvitationRecord;
    try {
      const created = await this.invitationModel.create({
        workspace: access.workspace._id,
        email: dto.email,
        role: dto.role,
        invitedBy: actorId,
        expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000),
      });
      invitation = created.toObject() as InvitationRecord;
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(
          'A pending invitation already exists for this email',
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
      inviterName: inviter
        ? `${inviter.firstName} ${inviter.lastName}`
        : 'A teammate',
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
      { populate: { path: 'invitedBy', select: PUBLIC_USER_SELECT } },
    ) as Promise<Paginated<InvitationRecord>>;
  }

  async cancel(
    actorId: string,
    workspaceId: string,
    invitationId: string,
  ): Promise<void> {
    const { workspace } = await this.access.authorize(
      actorId,
      workspaceId,
      Permission.MEMBER_INVITE,
    );
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
    const invitation = await this.claim(
      userId,
      invitationId,
      InvitationStatus.ACCEPTED,
    );
    if (!(await this.access.workspaceExists(invitation.workspace))) {
      await this.invitationModel
        .updateOne(
          { _id: invitation._id },
          { status: InvitationStatus.CANCELLED },
        )
        .exec();
      throw new GoneException('This invitation is no longer valid');
    }
    return this.members.addMember(
      invitation.workspace,
      userId,
      invitation.role,
      String(invitation.invitedBy),
    );
  }

  async decline(userId: string, invitationId: string): Promise<void> {
    const declined = await this.claim(
      userId,
      invitationId,
      InvitationStatus.DECLINED,
    );
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
   * Atomically moves a pending, unexpired invitation addressed to the caller
   * into its final state, so double-accepts and races cannot create two
   * memberships or resurrect an answered invite.
   */
  private async claim(
    userId: string,
    invitationId: string,
    status: InvitationStatus.ACCEPTED | InvitationStatus.DECLINED,
  ): Promise<InvitationRecord> {
    const email = await this.emailOf(userId);
    const now = new Date();
    const claimed = await this.invitationModel
      .findOneAndUpdate(
        {
          _id: invitationId,
          email,
          status: InvitationStatus.PENDING,
          expiresAt: { $gt: now },
        },
        { status, respondedAt: now },
        { new: true },
      )
      .lean<InvitationRecord>()
      .exec();
    if (claimed) return claimed;

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

  private async emailOf(userId: string): Promise<string> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    return user.email;
  }
}
