import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Permission } from '../common/authorization/permissions';
import { idEquals } from '../common/utils/query';
import {
  ProjectAccess,
  ProjectAccessService,
} from '../projects/project-access.service';
import { Task, TaskRecord } from './schemas/task.schema';

export interface TaskAccess extends ProjectAccess {
  task: TaskRecord;
}

/**
 * Task → project → workspace → membership → permission. Every endpoint that
 * receives a task id (tasks, comments, attachments, dependencies) goes
 * through here, so a task id from the client is never trusted.
 */
@Injectable()
export class TaskAccessService {
  private readonly logger = new Logger(TaskAccessService.name);

  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<Task>,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async authorize(
    userId: string,
    taskId: string | Types.ObjectId,
    permission: Permission,
  ): Promise<TaskAccess> {
    const task = await this.taskModel
      .findOne({ _id: taskId, deletedAt: null })
      .lean<TaskRecord>()
      .exec();
    if (!task) throw new NotFoundException('Task not found');

    let access: ProjectAccess;
    try {
      access = await this.projectAccess.authorize(
        userId,
        task.project,
        permission,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new NotFoundException('Task not found');
      }
      throw error;
    }
    // `task.workspace` is a copy of the project's; never trust a mismatch.
    if (!idEquals(task.workspace, access.project.workspace)) {
      this.logger.error(
        `Task ${task._id} workspace does not match its project; run db:check`,
      );
      throw new NotFoundException('Task not found');
    }
    return { ...access, task };
  }
}
