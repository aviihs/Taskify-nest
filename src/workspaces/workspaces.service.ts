import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Permission,
  ROLE_PERMISSIONS,
  WorkspaceRole,
} from '../common/authorization/permissions';
import { isDuplicateKeyError } from '../common/utils/mongo-errors';
import { toObjectId } from '../common/utils/query';
import { CreateWorkspaceDto, UpdateWorkspaceDto } from './dtos/workspace.dto';
import {
  Workspace,
  WorkspaceRecord,
  WorkspaceType,
} from './schemas/workspace.schema';
import {
  MemberStatus,
  WorkspaceMember,
  WorkspaceMemberRecord,
} from './schemas/workspace-member.schema';
import {
  WorkspaceAccess,
  WorkspaceAccessService,
} from './workspace-access.service';

export type WorkspaceView = WorkspaceRecord & {
  role: WorkspaceRole;
  title: string | null;
  permissions: Permission[];
  memberCount: number;
};

@Injectable()
export class WorkspacesService {
  constructor(
    @InjectModel(Workspace.name)
    private readonly workspaceModel: Model<Workspace>,
    @InjectModel(WorkspaceMember.name)
    private readonly memberModel: Model<WorkspaceMember>,
    private readonly access: WorkspaceAccessService,
  ) {}

  /**
   * Idempotent: called at registration and lazily for accounts created before
   * workspaces existed. The partial unique index makes concurrent calls safe.
   */
  async ensurePersonalWorkspace(
    userId: string | Types.ObjectId,
  ): Promise<WorkspaceRecord> {
    const owner = toObjectId(userId);
    const existing = await this.workspaceModel
      .findOne({ owner, type: WorkspaceType.PERSONAL })
      .lean<WorkspaceRecord>()
      .exec();
    if (existing) return existing;

    try {
      return await this.createWithOwner(owner, {
        name: 'Personal',
        type: WorkspaceType.PERSONAL,
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      return this.workspaceModel
        .findOne({ owner, type: WorkspaceType.PERSONAL })
        .lean<WorkspaceRecord>()
        .exec();
    }
  }

  async createOrganization(
    userId: string,
    dto: CreateWorkspaceDto,
  ): Promise<WorkspaceView> {
    const workspace = await this.createWithOwner(toObjectId(userId), {
      ...dto,
      type: WorkspaceType.ORGANIZATION,
    });
    return this.toView(workspace, WorkspaceRole.OWNER, null, 1);
  }

  async listForUser(userId: string): Promise<WorkspaceView[]> {
    await this.ensurePersonalWorkspace(userId);

    const memberships = await this.memberModel
      .find({ user: toObjectId(userId), status: MemberStatus.ACTIVE })
      .lean<WorkspaceMemberRecord[]>()
      .exec();
    const workspaceIds = memberships.map((m) => m.workspace);

    const [workspaces, counts] = await Promise.all([
      this.workspaceModel
        .find({ _id: { $in: workspaceIds }, deletedAt: null })
        .lean<WorkspaceRecord[]>()
        .exec(),
      this.memberCounts(workspaceIds),
    ]);
    const membershipByWorkspace = new Map(
      memberships.map((m) => [String(m.workspace), m]),
    );

    return workspaces
      .map((workspace) => {
        const member = membershipByWorkspace.get(String(workspace._id));
        return this.toView(
          workspace,
          member.role,
          member.title,
          counts.get(String(workspace._id)) ?? 0,
        );
      })
      .sort((a, b) =>
        a.type === b.type
          ? a.name.localeCompare(b.name)
          : a.type === WorkspaceType.PERSONAL
          ? -1
          : 1,
      );
  }

  async get(userId: string, workspaceId: string): Promise<WorkspaceView> {
    const access = await this.access.authorize(
      userId,
      workspaceId,
      Permission.WORKSPACE_READ,
    );
    return this.viewFromAccess(access);
  }

  async update(
    userId: string,
    workspaceId: string,
    dto: UpdateWorkspaceDto,
  ): Promise<WorkspaceView> {
    const access = await this.access.authorize(
      userId,
      workspaceId,
      Permission.WORKSPACE_UPDATE,
    );
    const workspace = await this.workspaceModel
      .findByIdAndUpdate(access.workspace._id, dto, {
        new: true,
        runValidators: true,
      })
      .lean<WorkspaceRecord>()
      .exec();
    return this.viewFromAccess({ ...access, workspace });
  }

  async remove(userId: string, workspaceId: string): Promise<void> {
    const access = await this.access.authorize(
      userId,
      workspaceId,
      Permission.WORKSPACE_DELETE,
    );
    if (access.workspace.type === WorkspaceType.PERSONAL) {
      throw new BadRequestException('Personal workspace cannot be deleted');
    }
    // Soft delete: every access check filters deletedAt, so all nested
    // projects/tasks become unreachable immediately while remaining recoverable.
    await this.workspaceModel
      .updateOne({ _id: access.workspace._id }, { deletedAt: new Date() })
      .exec();
  }

  private async createWithOwner(
    owner: Types.ObjectId,
    data: Partial<Workspace> & { type: WorkspaceType },
  ): Promise<WorkspaceRecord> {
    const workspace = await this.workspaceModel.create({ ...data, owner });
    try {
      await this.memberModel.create({
        workspace: workspace._id,
        user: owner,
        role: WorkspaceRole.OWNER,
      });
    } catch (error) {
      // No multi-document transaction here (standalone Mongo support); compensate instead.
      await this.workspaceModel.deleteOne({ _id: workspace._id }).exec();
      throw error;
    }
    return workspace.toObject() as WorkspaceRecord;
  }

  private async viewFromAccess({
    workspace,
    member,
  }: WorkspaceAccess): Promise<WorkspaceView> {
    const counts = await this.memberCounts([workspace._id]);
    return this.toView(
      workspace,
      member.role,
      member.title,
      counts.get(String(workspace._id)) ?? 0,
    );
  }

  private async memberCounts(
    workspaceIds: Types.ObjectId[],
  ): Promise<Map<string, number>> {
    const rows = await this.memberModel
      .aggregate<{ _id: Types.ObjectId; count: number }>([
        {
          $match: {
            workspace: { $in: workspaceIds },
            status: MemberStatus.ACTIVE,
          },
        },
        { $group: { _id: '$workspace', count: { $sum: 1 } } },
      ])
      .exec();
    return new Map(rows.map((r) => [String(r._id), r.count]));
  }

  private toView(
    workspace: WorkspaceRecord,
    role: WorkspaceRole,
    title: string | null,
    memberCount: number,
  ): WorkspaceView {
    return {
      ...workspace,
      role,
      title,
      memberCount,
      permissions: [...ROLE_PERMISSIONS[role]],
    };
  }
}
