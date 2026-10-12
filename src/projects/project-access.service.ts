import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  Permission,
  roleHasPermission,
} from '../common/authorization/permissions';
import { toObjectId } from '../common/utils/query';
import {
  assertCan,
  can,
  WorkspaceAccess,
  WorkspaceAccessService,
} from '../workspaces/workspace-access.service';
import { Project, ProjectRecord } from './schemas/project.schema';
import { ProjectMember } from './schemas/project-member.schema';

export interface ProjectAccess extends WorkspaceAccess {
  project: ProjectRecord;
}

/**
 * Project-level authorization, layered on workspace membership:
 *   project → workspace → caller's membership → project visibility → permission.
 * Invisible projects are reported as not found.
 */
@Injectable()
export class ProjectAccessService {
  constructor(
    @InjectModel(Project.name) private readonly projectModel: Model<Project>,
    @InjectModel(ProjectMember.name)
    private readonly projectMemberModel: Model<ProjectMember>,
    private readonly workspaceAccess: WorkspaceAccessService,
  ) {}

  async authorize(
    userId: string,
    projectId: string | Types.ObjectId,
    permission: Permission,
  ): Promise<ProjectAccess> {
    const project = await this.projectModel
      .findOne({ _id: projectId, deletedAt: null })
      .lean<ProjectRecord>()
      .exec();
    if (!project) throw new NotFoundException('Project not found');

    let access: WorkspaceAccess;
    try {
      access = await this.workspaceAccess.resolve(userId, project.workspace);
    } catch {
      throw new NotFoundException('Project not found');
    }
    if (!(await this.canSee(access, project._id))) {
      throw new NotFoundException('Project not found');
    }
    assertCan(access, permission);
    return { ...access, project };
  }

  /** Whether a (possibly different) user can see the project — e.g. to validate an assignee. */
  async canAccess(
    userId: string,
    projectId: string | Types.ObjectId,
  ): Promise<boolean> {
    try {
      await this.authorize(userId, projectId, Permission.PROJECT_READ);
      return true;
    } catch (error) {
      if (error instanceof NotFoundException) return false;
      throw error;
    }
  }

  /**
   * The subset of `userIds` who can currently see the project: an ACTIVE
   * member of its live workspace whose role reads every project, or who has a
   * project membership. A few queries for any number of users — use this
   * instead of calling `canAccess` in a loop.
   */
  async usersWithAccess(
    projectId: string | Types.ObjectId,
    userIds: Array<string | Types.ObjectId>,
  ): Promise<Set<string>> {
    const wanted = [...new Set(userIds.map(String))];
    if (!wanted.length) return new Set();
    const project = await this.projectModel
      .findOne({ _id: projectId, deletedAt: null })
      .select('workspace')
      .lean<ProjectRecord>()
      .exec();
    if (
      !project ||
      !(await this.workspaceAccess.workspaceExists(project.workspace))
    ) {
      return new Set();
    }

    const members = await this.workspaceAccess.activeMembers(
      project.workspace,
      wanted,
    );
    const allowed = new Set(
      members
        .filter((m) => roleHasPermission(m.role, Permission.PROJECT_READ_ALL))
        .map((m) => String(m.user)),
    );
    const restricted = members
      .filter((m) => !allowed.has(String(m.user)))
      .map((m) => m.user);
    if (restricted.length) {
      const visible: Types.ObjectId[] = await this.projectMemberModel
        .find({ project: project._id, user: { $in: restricted } })
        .distinct('user')
        .exec();
      visible.forEach((id) => allowed.add(String(id)));
    }
    return allowed;
  }

  /** Mongo filter selecting the projects of one workspace the caller can see. */
  async visibleProjectsFilter(
    access: WorkspaceAccess,
  ): Promise<FilterQuery<Project>> {
    const base: FilterQuery<Project> = {
      workspace: access.workspace._id,
      deletedAt: null,
    };
    if (can(access, Permission.PROJECT_READ_ALL)) return base;

    const memberOf = await this.projectMemberModel
      .find({ workspace: access.workspace._id, user: access.member.user })
      .distinct('project')
      .exec();
    return { ...base, _id: { $in: memberOf } };
  }

  /**
   * Every project id the user can see, optionally narrowed to some workspaces.
   * The single scoping primitive behind search, my tasks, dashboard and activity
   * — cross-workspace reads never build their own access rules.
   */
  async accessibleProjectIds(
    userId: string,
    workspaceIds?: Array<string | Types.ObjectId>,
  ): Promise<Types.ObjectId[]> {
    const wanted = workspaceIds && new Set(workspaceIds.map(String));
    const memberships = (await this.workspaceAccess.memberships(userId)).filter(
      (m) => !wanted || wanted.has(String(m.workspaceId)),
    );
    if (!memberships.length) return [];

    const readAll = memberships
      .filter((m) => roleHasPermission(m.role, Permission.PROJECT_READ_ALL))
      .map((m) => m.workspaceId);
    const restricted = memberships
      .filter((m) => !roleHasPermission(m.role, Permission.PROJECT_READ_ALL))
      .map((m) => m.workspaceId);

    const memberProjectIds: Types.ObjectId[] = restricted.length
      ? await this.projectMemberModel
          .find({ workspace: { $in: restricted }, user: toObjectId(userId) })
          .distinct('project')
          .exec()
      : [];

    return this.projectModel
      .find({
        deletedAt: null,
        $or: [
          { workspace: { $in: readAll } },
          { _id: { $in: memberProjectIds } },
        ],
      })
      .distinct('_id')
      .exec();
  }

  private async canSee(
    access: WorkspaceAccess,
    projectId: Types.ObjectId,
  ): Promise<boolean> {
    if (can(access, Permission.PROJECT_READ_ALL)) return true;
    return Boolean(
      await this.projectMemberModel.exists({
        project: projectId,
        user: access.member.user,
      }),
    );
  }
}
