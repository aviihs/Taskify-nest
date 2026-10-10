import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { pageMeta, paginate, Paginated } from '../common/pagination/pagination';
import { dayBounds, toObjectId } from '../common/utils/query';
import { ProjectAccessService } from '../projects/project-access.service';
import { MyTasksQueryDto, MyTasksView } from './dtos/task.dto';
import { Task, TaskRecord, TaskStatus } from './schemas/task.schema';
import { TASK_POPULATE, TaskView, TasksService } from './tasks.service';

/**
 * "My Tasks" is a view, not a model: tasks assigned to me, limited to the
 * projects I can still access (leaving a workspace hides its tasks).
 */
@Injectable()
export class MyTasksService {
  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<Task>,
    private readonly projectAccess: ProjectAccessService,
    private readonly tasks: TasksService,
  ) {}

  async list(
    userId: string,
    query: MyTasksQueryDto,
  ): Promise<Paginated<TaskView>> {
    let projectIds = await this.projectAccess.accessibleProjectIds(
      userId,
      query.workspaceId ? [query.workspaceId] : undefined,
    );
    if (query.projectId) {
      projectIds = projectIds.filter((id) => String(id) === query.projectId);
    }
    if (!projectIds.length) return { items: [], meta: pageMeta(query, 0) };

    const filter: FilterQuery<Task> = {
      assignees: toObjectId(userId),
      project: { $in: projectIds },
      deletedAt: null,
      ...this.viewFilter(query.view, query.tzOffset),
    };
    if (query.priority?.length) filter.priority = { $in: query.priority };

    const page = (await paginate(this.taskModel, filter, query, {
      sort:
        query.view === MyTasksView.COMPLETED
          ? { completedAt: -1 }
          : { dueDate: 1, createdAt: -1 },
      populate: [
        ...TASK_POPULATE,
        { path: 'project', select: 'name' },
        { path: 'workspace', select: 'name type' },
      ],
    })) as Paginated<TaskRecord>;
    return { ...page, items: await this.tasks.withSubtaskProgress(page.items) };
  }

  private viewFilter(view: MyTasksView, tzOffset: number): FilterQuery<Task> {
    const open = { status: { $ne: TaskStatus.DONE } };
    const { start, end } = dayBounds(tzOffset);
    switch (view) {
      case MyTasksView.TODAY:
        return { ...open, dueDate: { $gte: start, $lt: end } };
      case MyTasksView.UPCOMING:
        return { ...open, dueDate: { $gte: end } };
      case MyTasksView.OVERDUE:
        return { ...open, dueDate: { $lt: start } };
      case MyTasksView.COMPLETED:
        return { status: TaskStatus.DONE };
      default:
        return open;
    }
  }
}
