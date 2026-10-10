import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, PopulateOptions, Types } from 'mongoose';
import { Permission } from '../common/authorization/permissions';
import { DomainEventPublisher } from '../common/events/domain-event-publisher';
import { paginate, Paginated } from '../common/pagination/pagination';
import { diffChanges } from '../common/utils/diff';
import { containsInsensitive, toObjectId } from '../common/utils/query';
import { LabelsService } from '../labels/labels.service';
import {
  ProjectAccess,
  ProjectAccessService,
} from '../projects/project-access.service';
import { assertDateRange } from '../projects/projects.service';
import { PUBLIC_USER_SELECT } from '../users/public-user';
import { UserSchemaName } from '../users/schemas/user.schema';
import { assertCan } from '../workspaces/workspace-access.service';
import {
  CreateTaskDto,
  ListTasksQueryDto,
  UpdateTaskDto,
} from './dtos/task.dto';
import {
  assigneesOf,
  Task,
  TaskRecord,
  TaskStatus,
} from './schemas/task.schema';
import { TaskAccessService } from './task-access.service';
import { EMPTY_PROGRESS, Progress, progressBy } from './task-stats';

export const TASK_POPULATE: PopulateOptions[] = [
  { path: 'assignees', select: PUBLIC_USER_SELECT },
  // Pre-migration-002 documents; see `assigneesOf`.
  {
    path: 'assignee',
    model: UserSchemaName,
    select: PUBLIC_USER_SELECT,
    strictPopulate: false,
  },
  { path: 'labels', select: 'name color' },
];

export type TaskView = TaskRecord & { subtaskProgress: Progress };

@Injectable()
export class TasksService {
  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<Task>,
    private readonly projectAccess: ProjectAccessService,
    private readonly taskAccess: TaskAccessService,
    private readonly labels: LabelsService,
    private readonly events: DomainEventPublisher,
  ) {}

  async create(
    userId: string,
    projectId: string,
    dto: CreateTaskDto,
  ): Promise<TaskView> {
    const access = await this.projectAccess.authorize(
      userId,
      projectId,
      Permission.TASK_CREATE,
    );
    const { project } = access;
    assertDateRange(dto.startDate, dto.dueDate);

    const parentTask = dto.parentTaskId
      ? await this.resolveParent(project._id, dto.parentTaskId)
      : null;
    const assigneeIds = dto.assigneeIds ?? [];
    await this.assertAssignable(access, assigneeIds);

    const created = await this.taskModel.create({
      title: dto.title,
      description: dto.description,
      status: dto.status,
      priority: dto.priority,
      startDate: dto.startDate,
      dueDate: dto.dueDate,
      estimatedHours: dto.estimatedHours,
      workspace: project.workspace,
      project: project._id,
      parentTask,
      createdBy: toObjectId(userId),
      assignees: assigneeIds.map(toObjectId),
      labels: await this.labels.resolveForWorkspace(
        project.workspace,
        dto.labelIds ?? [],
      ),
      position: dto.position ?? Date.now(),
      completedAt: dto.status === TaskStatus.DONE ? new Date() : null,
    });

    this.events.publish({
      type: 'task.created',
      actorId: userId,
      workspaceId: String(project.workspace),
      projectId: String(project._id),
      taskId: String(created._id),
      entityId: String(created._id),
      title: created.title,
      assigneeIds,
      parentTaskId: parentTask ? String(parentTask) : null,
    });
    return this.getView(created._id);
  }

  async list(
    userId: string,
    projectId: string,
    query: ListTasksQueryDto,
  ): Promise<Paginated<TaskView>> {
    const { project } = await this.projectAccess.authorize(
      userId,
      projectId,
      Permission.TASK_READ,
    );
    const filter = this.buildListFilter(project._id, userId, query);
    const direction = query.order === 'desc' ? -1 : 1;
    const sortField = query.sort ?? 'position';

    const page = (await paginate(this.taskModel, filter, query, {
      sort: { [sortField]: direction, _id: direction },
      populate: TASK_POPULATE,
    })) as Paginated<TaskRecord>;
    return { ...page, items: await this.withSubtaskProgress(page.items) };
  }

  async get(userId: string, taskId: string): Promise<TaskView> {
    const { task } = await this.taskAccess.authorize(
      userId,
      taskId,
      Permission.TASK_READ,
    );
    return this.getView(task._id);
  }

  async listSubtasks(userId: string, taskId: string): Promise<TaskView[]> {
    const { task } = await this.taskAccess.authorize(
      userId,
      taskId,
      Permission.TASK_READ,
    );
    const subtasks = await this.taskModel
      .find({ parentTask: task._id, deletedAt: null })
      .sort({ position: 1, _id: 1 })
      .populate(TASK_POPULATE)
      .lean<TaskRecord[]>()
      .exec();
    return this.withSubtaskProgress(subtasks);
  }

  async update(
    userId: string,
    taskId: string,
    dto: UpdateTaskDto,
  ): Promise<TaskView> {
    const access = await this.taskAccess.authorize(
      userId,
      taskId,
      Permission.TASK_UPDATE,
    );
    const { task } = access;
    assertDateRange(
      dto.startDate === undefined ? task.startDate : dto.startDate,
      dto.dueDate === undefined ? task.dueDate : dto.dueDate,
    );

    const { assigneeIds, labelIds, ...fields } = dto;
    const patch: Partial<Task> = { ...fields };

    const current = assigneesOf(task).map(String);
    const addedAssigneeIds =
      assigneeIds?.filter((id) => !current.includes(id)) ?? [];
    if (
      assigneeIds &&
      (addedAssigneeIds.length || assigneeIds.length !== current.length)
    ) {
      assertCan(access, Permission.TASK_ASSIGN);
      await this.assertAssignable(access, addedAssigneeIds);
      patch.assignees = assigneeIds.map(toObjectId);
    }
    if (labelIds) {
      patch.labels = await this.labels.resolveForWorkspace(
        task.workspace,
        labelIds,
      );
    }
    const changes = diffChanges(task, patch);
    if (!Object.keys(changes).length) return this.getView(task._id);

    // Derived bookkeeping, not part of the user-visible change history.
    if (!task.assignees) patch.assignees ??= assigneesOf(task);
    if (changes.status) {
      patch.completedAt = dto.status === TaskStatus.DONE ? new Date() : null;
    }
    if (changes.dueDate) patch.dueReminderSentAt = null;

    const updated = await this.taskModel
      .findByIdAndUpdate(task._id, patch, { new: true, runValidators: true })
      .lean<TaskRecord>()
      .exec();

    this.events.publish({
      type: 'task.updated',
      actorId: userId,
      workspaceId: String(task.workspace),
      projectId: String(task.project),
      taskId: String(task._id),
      entityId: String(task._id),
      title: updated.title,
      createdById: String(task.createdBy),
      assigneeIds: assigneesOf(updated).map(String),
      addedAssigneeIds,
      changes,
    });
    return this.getView(task._id);
  }

  async remove(userId: string, taskId: string): Promise<void> {
    const { task } = await this.taskAccess.authorize(
      userId,
      taskId,
      Permission.TASK_DELETE,
    );
    const now = new Date();
    // Soft delete the task together with its subtasks.
    await this.taskModel
      .updateMany(
        { $or: [{ _id: task._id }, { parentTask: task._id }], deletedAt: null },
        { deletedAt: now },
      )
      .exec();

    this.events.publish({
      type: 'task.deleted',
      actorId: userId,
      workspaceId: String(task.workspace),
      projectId: String(task.project),
      taskId: String(task._id),
      entityId: String(task._id),
      title: task.title,
    });
  }

  async withSubtaskProgress(tasks: TaskRecord[]): Promise<TaskView[]> {
    const progress = await progressBy(
      this.taskModel,
      'parentTask',
      tasks.filter((t) => !t.parentTask).map((t) => t._id),
    );
    return tasks.map((task) => {
      // Expose pre-migration `assignee` as `assignees` only.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { assignee, ...rest } = task as TaskRecord & { assignee?: unknown };
      return {
        ...rest,
        assignees: assigneesOf(task),
        subtaskProgress: progress.get(String(task._id)) ?? EMPTY_PROGRESS,
      };
    });
  }

  private async getView(taskId: Types.ObjectId): Promise<TaskView> {
    const task = await this.taskModel
      .findById(taskId)
      .populate(TASK_POPULATE)
      .populate({ path: 'createdBy', select: PUBLIC_USER_SELECT })
      .lean<TaskRecord>()
      .exec();
    const [view] = await this.withSubtaskProgress([task]);
    return view;
  }

  private buildListFilter(
    projectId: Types.ObjectId,
    userId: string,
    query: ListTasksQueryDto,
  ): FilterQuery<Task> {
    const filter: FilterQuery<Task> = { project: projectId, deletedAt: null };

    if (query.parentTaskId) filter.parentTask = toObjectId(query.parentTaskId);
    else if (!query.includeSubtasks) filter.parentTask = null;

    if (query.status?.length) filter.status = { $in: query.status };
    if (query.priority?.length) filter.priority = { $in: query.priority };
    if (query.labelId) filter.labels = toObjectId(query.labelId);
    if (query.assigneeId === 'me') filter.assignees = toObjectId(userId);
    else if (query.assigneeId === 'none') filter.assignees = { $size: 0 };
    else if (query.assigneeId) {
      if (!Types.ObjectId.isValid(query.assigneeId)) {
        throw new BadRequestException(
          "assigneeId must be an id, 'me' or 'none'",
        );
      }
      filter.assignees = toObjectId(query.assigneeId);
    }
    if (query.dueFrom || query.dueTo) {
      filter.dueDate = {
        ...(query.dueFrom && { $gte: query.dueFrom }),
        ...(query.dueTo && { $lte: query.dueTo }),
      };
    }
    if (query.search) {
      const regex = containsInsensitive(query.search);
      filter.$or = [{ title: regex }, { description: regex }];
    }
    return filter;
  }

  /** Subtasks live in the same project and nest one level deep, so trees can never cycle. */
  private async resolveParent(
    projectId: Types.ObjectId,
    parentTaskId: string,
  ): Promise<Types.ObjectId> {
    const parent = await this.taskModel
      .findOne({ _id: parentTaskId, project: projectId, deletedAt: null })
      .select('parentTask')
      .lean<TaskRecord>()
      .exec();
    if (!parent) {
      throw new BadRequestException('Parent task not found in this project');
    }
    if (parent.parentTask) {
      throw new BadRequestException('Subtasks cannot have their own subtasks');
    }
    return parent._id;
  }

  /** Only newly added assignees are checked, so removing others never fails on someone who since lost access. */
  private async assertAssignable(
    access: ProjectAccess,
    assigneeIds: string[],
  ): Promise<void> {
    const allowed = await Promise.all(
      assigneeIds.map((id) =>
        this.projectAccess.canAccess(id, access.project._id),
      ),
    );
    if (allowed.includes(false)) {
      throw new BadRequestException(
        'Assignees must be workspace members with access to this project',
      );
    }
  }
}
