import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Permission,
  roleHasPermission,
  WorkspaceRole,
} from '../common/authorization/permissions';
import { toObjectId } from '../common/utils/query';
import { Workspace, WorkspaceRecord } from './schemas/workspace.schema';
import {
  MemberStatus,
  WorkspaceMember,
  WorkspaceMemberRecord,
} from './schemas/workspace-member.schema';

/** Result of a successful workspace authorization: who the user is inside this workspace. */
export interface WorkspaceAccess {
  workspace: WorkspaceRecord;
  member: WorkspaceMemberRecord;
}

export function can(access: WorkspaceAccess, permission: Permission): boolean {
  return roleHasPermission(access.member.role, permission);
}

export function assertCan(
  access: WorkspaceAccess,
  permission: Permission,
): void {
  if (!can(access, permission)) {
    throw new ForbiddenException(`Missing permission: ${permission}`);
  }
}

export interface MembershipSummary {
  workspaceId: Types.ObjectId;
  role: WorkspaceRole;
}

/**
 * Resolves the caller's membership server-side. Never trusts a workspaceId
 * from the client: if the user is not an active member the workspace is
 * reported as not found, so its existence is not leaked.
 */
@Injectable()
export class WorkspaceAccessService {
  constructor(
    @InjectModel(Workspace.name)
    private readonly workspaceModel: Model<Workspace>,
    @InjectModel(WorkspaceMember.name)
    private readonly memberModel: Model<WorkspaceMember>,
  ) {}

  async authorize(
    userId: string,
    workspaceId: string | Types.ObjectId,
    permission: Permission,
  ): Promise<WorkspaceAccess> {
    const access = await this.resolve(userId, workspaceId);
    assertCan(access, permission);
    return access;
  }

  async resolve(
    userId: string,
    workspaceId: string | Types.ObjectId,
  ): Promise<WorkspaceAccess> {
    const [workspace, member] = await Promise.all([
      this.workspaceModel
        .findOne({ _id: workspaceId, deletedAt: null })
        .lean<WorkspaceRecord>()
        .exec(),
      this.memberModel
        .findOne({
          workspace: workspaceId,
          user: userId,
          status: MemberStatus.ACTIVE,
        })
        .lean<WorkspaceMemberRecord>()
        .exec(),
    ]);
    if (!workspace || !member) {
      throw new NotFoundException('Workspace not found');
    }
    return { workspace, member };
  }

  /** Active memberships in non-deleted workspaces. Basis for every cross-workspace query (search, my tasks, …). */
  async memberships(userId: string): Promise<MembershipSummary[]> {
    const members = await this.memberModel
      .find({ user: toObjectId(userId), status: MemberStatus.ACTIVE })
      .select('workspace role')
      .lean<WorkspaceMemberRecord[]>()
      .exec();
    if (!members.length) return [];

    const live = await this.workspaceModel
      .find({ _id: { $in: members.map((m) => m.workspace) }, deletedAt: null })
      .select('_id')
      .lean<WorkspaceRecord[]>()
      .exec();
    const liveIds = new Set(live.map((w) => String(w._id)));

    return members
      .filter((m) => liveIds.has(String(m.workspace)))
      .map((m) => ({ workspaceId: m.workspace, role: m.role }));
  }

  async workspaceExists(
    workspaceId: string | Types.ObjectId,
  ): Promise<boolean> {
    return Boolean(
      await this.workspaceModel.exists({ _id: workspaceId, deletedAt: null }),
    );
  }

  /** True when the user is an active member — used to validate assignees, mentions, project members. */
  async isActiveMember(
    workspaceId: string | Types.ObjectId,
    userId: string | Types.ObjectId,
  ): Promise<boolean> {
    const exists = await this.memberModel.exists({
      workspace: workspaceId,
      user: userId,
      status: MemberStatus.ACTIVE,
    });
    return Boolean(exists);
  }

  /** Everyone sharing at least one of these workspaces (for people search). */
  async coMemberIds(workspaceIds: Types.ObjectId[]): Promise<Types.ObjectId[]> {
    if (!workspaceIds.length) return [];
    return this.memberModel
      .find({ workspace: { $in: workspaceIds }, status: MemberStatus.ACTIVE })
      .distinct('user')
      .exec();
  }
}
