import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { User } from '../users/dtos/user.dto';
import { UpdateTaskDto } from './interfaces/update-task.dto';
import { CreateTaskDto } from './interfaces/create-task.dto';
import { TaskRepository } from './repositories/task.repository';
import { TaskStatus } from './interfaces/task-status.enum';
import { TaskPriority } from './interfaces/task-priority.enum';

@Injectable()
export class TaskService {
  constructor(private readonly taskRepository: TaskRepository) { }

  async validateUser(userId: string, taskId: string): Promise<boolean> {
    const task = await this.taskRepository.findById(taskId);
    if (!task) {
      return false;
    }
    return (
      task.createdBy.toString() === userId.toString() ||
      (task.assignedTo && task.assignedTo.toString() === userId.toString())
    );
  }

  async addTask(dto: CreateTaskDto, user: User) {
    const payload: any = {
      title: dto.title,
      description: dto.description,
      status: dto.status || TaskStatus.TODO,
      priority: dto.priority || TaskPriority.LOW,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      assignedTo: dto.assignedTo ? new Types.ObjectId(dto.assignedTo) : null,
      project: dto.project ? new Types.ObjectId(dto.project) : null,
      labels: dto.labels || [],
      tags: dto.tags || [],
      estimatedHours: dto.estimatedHours || 0,
      actualHours: dto.actualHours || 0,
      createdBy: new Types.ObjectId(user.id),
      isDeleted: false,
      isArchived: false,
    };

    const task = await this.taskRepository.create(payload);

    return {
      message: 'Task created successfully',
      timestamp: new Date().toISOString(),
      task,
    };
  }

  async listTasks(user: User, query: any) {
    const page = Number(query.page) > 0 ? Number(query.page) : 1;
    const limit = Number(query.limit) > 0 ? Number(query.limit) : 10;
    const skip = (page - 1) * limit;

    const userId = new Types.ObjectId(user.id);

    const filter: any = {
      isDeleted: false,
      $or: [
        { createdBy: userId },
        { assignedTo: userId },
      ],
    };

    if (query.search) {
      filter.$and = [
        {
          $or: [
            { title: { $regex: query.search, $options: 'i' } },
            { description: { $regex: query.search, $options: 'i' } },
          ],
        },
      ];
    }

    if (query.status) filter.status = query.status;
    if (query.priority) filter.priority = query.priority;
    if (query.project) filter.project = query.project;
    if (query.assignedTo) filter.assignedTo = query.assignedTo;
    if (query.dueDateFrom || query.dueDateTo) {
      filter.dueDate = {};
      if (query.dueDateFrom) filter.dueDate.$gte = new Date(query.dueDateFrom);
      if (query.dueDateTo) filter.dueDate.$lte = new Date(query.dueDateTo);
    }

    const [tasks, total] = await Promise.all([
      this.taskRepository.find(filter, { skip, limit }),
      this.taskRepository.count(filter),
    ]);


    return {
      message: 'Tasks fetched successfully',
      timestamp: new Date().toISOString(),
      tasks,
      page,
      limit,
      total,
    };
  }

  // async listTasks(user: User, query: any) {
  //   const tasks = await this.taskRepository.find({}, { skip: 0, limit: 100 });

  //   console.log(tasks);

  //   return {
  //     tasks,
  //   };
  // }



  async listTaskById(id: string, user: User) {
    const task = await this.ensureAccessTask(id, user);

    return {
      message: 'Task fetched successfully',
      timestamp: new Date().toISOString(),
      task,
    };
  }

  private async ensureAccessTask(id: string, user: User) {
    const task = await this.taskRepository.findById(id);

    if (!task || task.isDeleted) {
      throw new HttpException('Task not found', HttpStatus.NOT_FOUND);
    }

    const isOwner = task.createdBy.toString() === user.id.toString();
    const isAssignee =
      task.assignedTo && task.assignedTo.toString() === user.id.toString();

    if (!isOwner && !isAssignee) {
      throw new HttpException('Access denied', HttpStatus.FORBIDDEN);
    }

    return task;
  }

  async deleteTask(id: string, user: User) {
    const task = await this.ensureAccessTask(id, user);

    task.isDeleted = true;
    await task.save();

    return {
      message: 'Task deleted successfully',
      timestamp: new Date().toISOString(),
    };
  }

  async archiveTask(id: string, user: User) {
    const task = await this.ensureAccessTask(id, user);
    task.isArchived = true;
    await task.save();

    return {
      message: 'Task archived successfully',
      timestamp: new Date().toISOString(),
      task,
    };
  }

  async updateTask(id: string, dto: UpdateTaskDto, user: User) {
    const task = await this.ensureAccessTask(id, user);

    const updatePayload: any = { ...dto };
    if (dto.dueDate) updatePayload.dueDate = new Date(dto.dueDate);
    if (dto.assignedTo)
      updatePayload.assignedTo = new Types.ObjectId(dto.assignedTo);
    if (dto.project) updatePayload.project = new Types.ObjectId(dto.project);

    Object.assign(task, updatePayload);
    await task.save();

    return {
      message: 'Task updated successfully',
      timestamp: new Date().toISOString(),
      task,
    };
  }

  async assignTask(id: string, assigneeId: string, user: User) {
    const task = await this.ensureAccessTask(id, user);
    task.assignedTo = new Types.ObjectId(assigneeId);
    await task.save();

    return {
      message: 'Task assigned successfully',
      timestamp: new Date().toISOString(),
      task,
    };
  }

  async removeAssignment(id: string, user: User) {
    const task = await this.ensureAccessTask(id, user);
    task.assignedTo = null;
    await task.save();

    return {
      message: 'Task assignment removed successfully',
      timestamp: new Date().toISOString(),
      task,
    };
  }
}
