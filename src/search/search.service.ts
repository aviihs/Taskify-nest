import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Comment,
  CommentRecord,
} from '../comments/schemas/task-comment.schema';
import { containsInsensitive } from '../common/utils/query';
import { ProjectAccessService } from '../projects/project-access.service';
import { Project, ProjectRecord } from '../projects/schemas/project.schema';
import { Task, TaskRecord } from '../tasks/schemas/task.schema';
import { PUBLIC_USER_SELECT, PublicUser } from '../users/public-user';
import { UserSchemaName } from '../users/schemas/user.schema';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';
import { SEARCH_TYPES, SearchQueryDto, SearchType } from './search.dto';

export interface SearchResults {
  tasks: TaskRecord[];
  projects: ProjectRecord[];
  users: PublicUser[];
  comments: CommentRecord[];
}

/**
 * Global search. Every query is constrained to the workspaces/projects the
 * caller can access, resolved once up front — never from client input.
 */
@Injectable()
export class SearchService {
  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<Task>,
    @InjectModel(Project.name) private readonly projectModel: Model<Project>,
    @InjectModel(Comment.name) private readonly commentModel: Model<Comment>,
    @InjectModel(UserSchemaName) private readonly userModel: Model<PublicUser>,
    private readonly workspaceAccess: WorkspaceAccessService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async search(userId: string, query: SearchQueryDto): Promise<SearchResults> {
    const types = new Set<SearchType>(
      query.types?.length ? query.types : SEARCH_TYPES,
    );
    const workspaceIds = (await this.workspaceAccess.memberships(userId))
      .map((m) => m.workspaceId)
      .filter((id) => !query.workspaceId || String(id) === query.workspaceId);
    const projectIds = workspaceIds.length
      ? await this.projectAccess.accessibleProjectIds(userId, workspaceIds)
      : [];

    const regex = containsInsensitive(query.q);
    const { limit } = query;
    const none = Promise.resolve([]);

    const [tasks, projects, users, comments] = await Promise.all([
      types.has('tasks') ? this.searchTasks(projectIds, regex, limit) : none,
      types.has('projects')
        ? this.searchProjects(projectIds, regex, limit)
        : none,
      types.has('users') ? this.searchUsers(workspaceIds, regex, limit) : none,
      types.has('comments')
        ? this.searchComments(projectIds, regex, limit)
        : none,
    ]);
    return { tasks, projects, users, comments };
  }

  private searchTasks(
    projectIds: Types.ObjectId[],
    regex: RegExp,
    limit: number,
  ) {
    if (!projectIds.length) return Promise.resolve([]);
    return this.taskModel
      .find({
        project: { $in: projectIds },
        deletedAt: null,
        $or: [{ title: regex }, { description: regex }],
      })
      .select(
        'title status priority dueDate project workspace parentTask assignee',
      )
      .populate({ path: 'project', select: 'name' })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean<TaskRecord[]>()
      .exec();
  }

  private searchProjects(
    projectIds: Types.ObjectId[],
    regex: RegExp,
    limit: number,
  ) {
    if (!projectIds.length) return Promise.resolve([]);
    return this.projectModel
      .find({
        _id: { $in: projectIds },
        $or: [{ name: regex }, { description: regex }],
      })
      .select('name status workspace dueDate')
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean<ProjectRecord[]>()
      .exec();
  }

  /** People search only returns users who share a workspace with the caller. */
  private async searchUsers(
    workspaceIds: Types.ObjectId[],
    regex: RegExp,
    limit: number,
  ): Promise<PublicUser[]> {
    const userIds = await this.workspaceAccess.coMemberIds(workspaceIds);
    if (!userIds.length) return [];
    return this.userModel
      .find({
        _id: { $in: userIds },
        isDeleted: false,
        $or: [
          { firstName: regex },
          { lastName: regex },
          { userName: regex },
          { email: regex },
        ],
      })
      .select(PUBLIC_USER_SELECT)
      .limit(limit)
      .lean<PublicUser[]>()
      .exec();
  }

  private searchComments(
    projectIds: Types.ObjectId[],
    regex: RegExp,
    limit: number,
  ) {
    if (!projectIds.length) return Promise.resolve([]);
    return this.commentModel
      .find({ project: { $in: projectIds }, content: regex })
      .select('content task project author createdAt')
      .populate({ path: 'author', select: PUBLIC_USER_SELECT })
      .populate({ path: 'task', select: 'title' })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<CommentRecord[]>()
      .exec();
  }
}
