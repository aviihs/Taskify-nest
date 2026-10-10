import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { Permission } from '../common/authorization/permissions';
import { ALL_DOMAIN_EVENTS, DomainEvent } from '../common/events/domain-events';
import { OnDomainEvent } from '../common/events/on-domain-event.decorator';
import {
  paginate,
  Paginated,
  PaginationQueryDto,
} from '../common/pagination/pagination';
import { toObjectId } from '../common/utils/query';
import { ProjectAccessService } from '../projects/project-access.service';
import { TaskAccessService } from '../tasks/task-access.service';
import { PUBLIC_USER_SELECT } from '../users/public-user';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';
import { ActivityLog, ActivityLogRecord } from './schemas/activity-log.schema';

const ACTOR_POPULATE = { path: 'actor', select: PUBLIC_USER_SELECT };

/** `task.updated` → task, `workspace.member.joined` / `project.member.added` → member. */
const entityTypeOf = (type: string): string => {
  const parts = type.split('.');
  return parts.length === 3 ? parts[1] : parts[0];
};

@Injectable()
export class ActivityService {
  constructor(
    @InjectModel(ActivityLog.name)
    private readonly activityModel: Model<ActivityLog>,
    private readonly workspaceAccess: WorkspaceAccessService,
    private readonly projectAccess: ProjectAccessService,
    private readonly taskAccess: TaskAccessService,
  ) {}

  /** The one place activity is written: every domain event becomes a log entry. */
  @OnDomainEvent(...ALL_DOMAIN_EVENTS)
  async record(event: DomainEvent): Promise<void> {
    const {
      type,
      actorId,
      workspaceId,
      projectId,
      taskId,
      entityId,
      ...metadata
    } = event;
    await this.activityModel.create({
      workspace: toObjectId(workspaceId),
      project: projectId ? toObjectId(projectId) : null,
      task: taskId ? toObjectId(taskId) : null,
      actor: toObjectId(actorId),
      action: type,
      entityType: entityTypeOf(type),
      entityId: toObjectId(entityId),
      metadata,
    });
  }

  /** Workspace feed, hiding activity from projects the caller cannot see. */
  async forWorkspace(
    userId: string,
    workspaceId: string,
    pagination: PaginationQueryDto,
  ): Promise<Paginated<ActivityLogRecord>> {
    const { workspace } = await this.workspaceAccess.authorize(
      userId,
      workspaceId,
      Permission.ACTIVITY_READ,
    );
    const projectIds = await this.projectAccess.accessibleProjectIds(userId, [
      workspace._id,
    ]);
    return this.page(
      {
        workspace: workspace._id,
        $or: [{ project: null }, { project: { $in: projectIds } }],
      },
      pagination,
    );
  }

  async forProject(
    userId: string,
    projectId: string,
    pagination: PaginationQueryDto,
  ): Promise<Paginated<ActivityLogRecord>> {
    const { project } = await this.projectAccess.authorize(
      userId,
      projectId,
      Permission.ACTIVITY_READ,
    );
    return this.page({ project: project._id }, pagination);
  }

  async forTask(
    userId: string,
    taskId: string,
    pagination: PaginationQueryDto,
  ): Promise<Paginated<ActivityLogRecord>> {
    const { task } = await this.taskAccess.authorize(
      userId,
      taskId,
      Permission.ACTIVITY_READ,
    );
    return this.page({ task: task._id }, pagination);
  }

  private page(
    filter: FilterQuery<ActivityLog>,
    pagination: PaginationQueryDto,
  ): Promise<Paginated<ActivityLogRecord>> {
    return paginate(this.activityModel, filter, pagination, {
      populate: ACTOR_POPULATE,
    }) as Promise<Paginated<ActivityLogRecord>>;
  }
}
