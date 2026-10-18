import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  ClientSession,
  FilterQuery,
  Model,
  PipelineStage,
  Types,
} from 'mongoose';
import {
  canManageRole,
  Permission,
  WorkspaceRole,
} from '../common/authorization/permissions';
import { TransactionRunner } from '../common/database/transaction-runner';
import { DomainEventPublisher } from '../common/events/domain-event-publisher';
import { PresenceService } from '../chat/presence.service';
import { pageMeta, Paginated } from '../common/pagination/pagination';
import { isDuplicateKeyError } from '../common/utils/mongo-errors';
import {
  containsInsensitive,
  idEquals,
  toObjectId,
} from '../common/utils/query';
import { ProjectMember } from '../projects/schemas/project-member.schema';
import { Task, TaskStatus } from '../tasks/schemas/task.schema';
import { lookupPublicUser, PublicUser } from '../users/public-user';
import { ListMembersQueryDto, UpdateMemberDto } from './dtos/workspace.dto';
import { WorkspaceType } from './schemas/workspace.schema';
import {
  WorkspaceMember,
  WorkspaceMemberRecord,
} from './schemas/workspace-member.schema';
import {
  assertCan,
  WorkspaceAccess,
  WorkspaceAccessService,
} from './workspace-access.service';

export type MemberView = Omit<WorkspaceMemberRecord, 'user'> & {
  user: PublicUser;
};

/** A listed member plus whether they are online right now (honours "appear offline"). */
export type MemberListItem = MemberView & { online: boolean };

@Injectable()
export class WorkspaceMembersService {
  constructor(
    @InjectModel(WorkspaceMember.name)
    private readonly memberModel: Model<WorkspaceMember>,
    // Cascade targets when a member leaves (see docs/DATA_MODEL.md §4).
    @InjectModel(ProjectMember.name)
    private readonly projectMemberModel: Model<ProjectMember>,
    @InjectModel(Task.name) private readonly taskModel: Model<Task>,
    private readonly access: WorkspaceAccessService,
    private readonly events: DomainEventPublisher,
    private readonly tx: TransactionRunner,
    private readonly presence: PresenceService,
  ) {}

  async list(
    userId: string,
    workspaceId: string,
    query: ListMembersQueryDto,
  ): Promise<Paginated<MemberListItem>> {
    const { workspace } = await this.access.authorize(
      userId,
      workspaceId,
      Permission.MEMBER_READ,
    );

    const match: FilterQuery<WorkspaceMember> = { workspace: workspace._id };
    if (query.role) match.role = query.role;

    const pipeline: PipelineStage[] = [
      { $match: match },
      lookupPublicUser('user'),
      { $unwind: '$user' },
    ];
    if (query.search) {
      const regex = containsInsensitive(query.search);
      pipeline.push({
        $match: {
          $or: [
            { 'user.firstName': regex },
            { 'user.lastName': regex },
            { 'user.userName': regex },
            { 'user.email': regex },
          ],
        },
      });
    }
    pipeline.push(
      { $sort: { joinedAt: 1 } },
      {
        $facet: {
          items: [
            { $skip: (query.page - 1) * query.limit },
            { $limit: query.limit },
          ],
          total: [{ $count: 'count' }],
        },
      },
    );

    const [result] = await this.memberModel
      .aggregate<{ items: MemberView[]; total: { count: number }[] }>(pipeline)
      .exec();
    const online = await this.presence.onlineUserIds(
      result.items.map((m) => m.user._id),
    );
    return {
      items: result.items.map((m) => ({
        ...m,
        online: online.has(String(m.user._id)),
      })),
      meta: pageMeta(query, result.total[0]?.count ?? 0),
    };
  }

  /**
   * Internal: used by invitation acceptance, inside its transaction.
   * Authorization happens in the caller, which also publishes
   * `workspace.member.joined` after commit.
   */
  async addMember(
    workspaceId: Types.ObjectId,
    userId: string,
    role: WorkspaceRole,
    invitedBy: string,
    session: ClientSession,
  ): Promise<WorkspaceMemberRecord> {
    try {
      const [member] = await this.memberModel.create(
        [
          {
            workspace: workspaceId,
            user: toObjectId(userId),
            role,
            invitedBy: toObjectId(invitedBy),
          },
        ],
        { session },
      );
      return member.toObject() as WorkspaceMemberRecord;
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(
          'User is already a member of this workspace',
        );
      }
      throw error;
    }
  }

  async update(
    actorId: string,
    workspaceId: string,
    targetUserId: string,
    dto: UpdateMemberDto,
  ): Promise<WorkspaceMemberRecord> {
    const access = await this.access.authorize(
      actorId,
      workspaceId,
      Permission.MEMBER_UPDATE,
    );
    const target = await this.findManageableMember(access, targetUserId);

    if (dto.role && dto.role !== target.role) {
      if (!canManageRole(access.member.role, dto.role)) {
        throw new ForbiddenException('You cannot grant this role');
      }
    }

    const updated = await this.memberModel
      .findByIdAndUpdate(target._id, dto, { new: true, runValidators: true })
      .lean<WorkspaceMemberRecord>()
      .exec();

    if (dto.role && dto.role !== target.role) {
      this.events.publish({
        type: 'workspace.member.role_changed',
        actorId,
        workspaceId,
        entityId: String(target._id),
        userId: targetUserId,
        changes: { role: { from: target.role, to: dto.role } },
      });
    }
    if (dto.status && dto.status !== target.status) {
      this.events.publish({
        type: 'workspace.member.status_changed',
        actorId,
        workspaceId,
        entityId: String(target._id),
        userId: targetUserId,
        changes: { status: { from: target.status, to: dto.status } },
      });
    }
    return updated;
  }

  /** Removes another member, or leaves the workspace when target is the caller. */
  async remove(
    actorId: string,
    workspaceId: string,
    targetUserId: string,
  ): Promise<void> {
    const isSelf = idEquals(actorId, targetUserId);
    const access = await this.access.resolve(actorId, workspaceId);
    this.assertOrganization(access);

    let target: WorkspaceMemberRecord;
    if (isSelf) {
      if (access.member.role === WorkspaceRole.OWNER) {
        throw new BadRequestException(
          'The owner cannot leave the workspace. Transfer ownership or delete it instead.',
        );
      }
      target = access.member;
    } else {
      assertCan(access, Permission.MEMBER_REMOVE);
      target = await this.findManageableMember(access, targetUserId);
    }

    const workspace = access.workspace._id;
    const user = target.user;
    // Leaving revokes everything that depended on the membership.
    await this.tx.run(async (session) => {
      await this.memberModel.deleteOne({ _id: target._id }, { session }).exec();
      await this.projectMemberModel
        .deleteMany({ workspace, user }, { session })
        .exec();
      // Open work goes back to the pool; finished work keeps its history.
      await this.taskModel
        .updateMany(
          {
            workspace,
            assignees: user,
            status: { $ne: TaskStatus.DONE },
            deletedAt: null,
          },
          { $pull: { assignees: user } },
          { session },
        )
        .exec();
    });
    this.events.publish({
      type: 'workspace.member.removed',
      actorId,
      workspaceId,
      entityId: String(target._id),
      userId: targetUserId,
    });
  }

  private async findManageableMember(
    access: WorkspaceAccess,
    targetUserId: string,
  ): Promise<WorkspaceMemberRecord> {
    this.assertOrganization(access);
    if (idEquals(access.member.user, targetUserId)) {
      throw new BadRequestException('You cannot change your own membership');
    }
    const target = await this.memberModel
      .findOne({ workspace: access.workspace._id, user: targetUserId })
      .lean<WorkspaceMemberRecord>()
      .exec();
    if (!target) throw new NotFoundException('Member not found');
    if (!canManageRole(access.member.role, target.role)) {
      throw new ForbiddenException('You cannot manage a member with this role');
    }
    return target;
  }

  private assertOrganization(access: WorkspaceAccess): void {
    if (access.workspace.type === WorkspaceType.PERSONAL) {
      throw new BadRequestException(
        'Personal workspaces do not support members',
      );
    }
  }
}
