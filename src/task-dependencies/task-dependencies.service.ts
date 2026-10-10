import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Permission } from '../common/authorization/permissions';
import { DomainEventPublisher } from '../common/events/domain-event-publisher';
import { TaskDeletedEvent } from '../common/events/domain-events';
import { OnDomainEvent } from '../common/events/on-domain-event.decorator';
import { isDuplicateKeyError } from '../common/utils/mongo-errors';
import { idEquals, toObjectId } from '../common/utils/query';
import { Task, TaskRecord, TaskStatus } from '../tasks/schemas/task.schema';
import { TaskAccessService } from '../tasks/task-access.service';
import {
  TASK_DEPENDENCY_COLLECTION,
  TaskDependency,
  TaskDependencyRecord,
} from './schemas/task-dependency.schema';

type TaskSummary = Pick<
  TaskRecord,
  '_id' | 'title' | 'status' | 'assignees' | 'dueDate'
>;

export interface DependencyEdgeView {
  dependencyId: Types.ObjectId;
  task: TaskSummary;
}

export interface TaskDependenciesView {
  /** Tasks that must finish before this one. */
  blockedBy: DependencyEdgeView[];
  /** Tasks waiting on this one. */
  blocking: DependencyEdgeView[];
  isBlocked: boolean;
}

@Injectable()
export class TaskDependenciesService {
  constructor(
    @InjectModel(TaskDependency.name)
    private readonly dependencyModel: Model<TaskDependency>,
    @InjectModel(Task.name) private readonly taskModel: Model<Task>,
    private readonly taskAccess: TaskAccessService,
    private readonly events: DomainEventPublisher,
  ) {}

  async list(userId: string, taskId: string): Promise<TaskDependenciesView> {
    const { task } = await this.taskAccess.authorize(
      userId,
      taskId,
      Permission.TASK_READ,
    );
    const edges = await this.dependencyModel
      .find({ $or: [{ blockedTask: task._id }, { blockingTask: task._id }] })
      .lean<TaskDependencyRecord[]>()
      .exec();

    const otherIds = edges.map((e) =>
      idEquals(e.blockedTask, task._id) ? e.blockingTask : e.blockedTask,
    );
    const tasks = await this.taskModel
      .find({ _id: { $in: otherIds }, deletedAt: null })
      .select('title status assignees dueDate')
      .lean<TaskSummary[]>()
      .exec();
    const byId = new Map(tasks.map((t) => [String(t._id), t]));

    const view: TaskDependenciesView = {
      blockedBy: [],
      blocking: [],
      isBlocked: false,
    };
    for (const edge of edges) {
      const isBlockedBy = idEquals(edge.blockedTask, task._id);
      const other = byId.get(
        String(isBlockedBy ? edge.blockingTask : edge.blockedTask),
      );
      if (!other) continue;
      (isBlockedBy ? view.blockedBy : view.blocking).push({
        dependencyId: edge._id,
        task: other,
      });
    }
    view.isBlocked = view.blockedBy.some(
      (d) => d.task.status !== TaskStatus.DONE,
    );
    return view;
  }

  /** Marks `taskId` as blocked by `blockingTaskId`. */
  async add(
    userId: string,
    taskId: string,
    blockingTaskId: string,
  ): Promise<TaskDependencyRecord> {
    const { task } = await this.taskAccess.authorize(
      userId,
      taskId,
      Permission.TASK_UPDATE,
    );
    if (idEquals(task._id, blockingTaskId)) {
      throw new BadRequestException('A task cannot depend on itself');
    }
    const blocking = await this.taskModel
      .findOne({ _id: blockingTaskId, project: task.project, deletedAt: null })
      .select('_id')
      .lean<TaskRecord>()
      .exec();
    if (!blocking) {
      throw new BadRequestException('Blocking task not found in this project');
    }
    if (await this.wouldCreateCycle(blocking._id, task._id)) {
      throw new BadRequestException('This dependency would create a cycle');
    }

    let dependency: TaskDependencyRecord;
    try {
      const created = await this.dependencyModel.create({
        project: task.project,
        blockingTask: blocking._id,
        blockedTask: task._id,
        createdBy: toObjectId(userId),
      });
      dependency = created.toObject() as TaskDependencyRecord;
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('This dependency already exists');
      }
      throw error;
    }

    this.events.publish({
      type: 'dependency.added',
      actorId: userId,
      workspaceId: String(task.workspace),
      projectId: String(task.project),
      taskId: String(task._id),
      entityId: String(dependency._id),
      blockingTaskId: String(blocking._id),
      blockedTaskId: String(task._id),
    });
    return dependency;
  }

  async remove(
    userId: string,
    taskId: string,
    dependencyId: string,
  ): Promise<void> {
    const { task } = await this.taskAccess.authorize(
      userId,
      taskId,
      Permission.TASK_UPDATE,
    );
    const removed = await this.dependencyModel
      .findOneAndDelete({
        _id: dependencyId,
        $or: [{ blockedTask: task._id }, { blockingTask: task._id }],
      })
      .lean<TaskDependencyRecord>()
      .exec();
    if (!removed) throw new NotFoundException('Dependency not found');

    this.events.publish({
      type: 'dependency.removed',
      actorId: userId,
      workspaceId: String(task.workspace),
      projectId: String(task.project),
      taskId: String(task._id),
      entityId: String(removed._id),
      blockingTaskId: String(removed.blockingTask),
      blockedTaskId: String(removed.blockedTask),
    });
  }

  @OnDomainEvent('task.deleted')
  async onTaskDeleted(event: TaskDeletedEvent): Promise<void> {
    const id = toObjectId(event.entityId);
    await this.dependencyModel
      .deleteMany({ $or: [{ blockingTask: id }, { blockedTask: id }] })
      .exec();
  }

  /**
   * Adding "A blocks B" closes a cycle iff B already (transitively) blocks A.
   * One $graphLookup walks everything downstream of B.
   */
  private async wouldCreateCycle(
    blockingId: Types.ObjectId,
    blockedId: Types.ObjectId,
  ): Promise<boolean> {
    const paths = await this.dependencyModel
      .aggregate([
        { $match: { blockingTask: blockedId } },
        {
          $graphLookup: {
            from: TASK_DEPENDENCY_COLLECTION,
            startWith: '$blockedTask',
            connectFromField: 'blockedTask',
            connectToField: 'blockingTask',
            as: 'chain',
          },
        },
        {
          $match: {
            $or: [
              { blockedTask: blockingId },
              { 'chain.blockedTask': blockingId },
            ],
          },
        },
        { $limit: 1 },
      ])
      .exec();
    return paths.length > 0;
  }
}
