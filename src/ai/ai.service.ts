import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Permission } from '../common/authorization/permissions';
import { ProjectAccessService } from '../projects/project-access.service';
import { Task, TaskRecord } from '../tasks/schemas/task.schema';
import { TasksService, TaskView } from '../tasks/tasks.service';
import { ApplyBreakdownDto } from './ai.dto';
import { SuggestedTask, TaskPlanner } from './task-planner';

/**
 * AI features as a separate layer. Suggestions are read-only; applying them
 * goes through TasksService, so permissions, validation, activity and
 * notifications behave exactly as for hand-created tasks.
 */
@Injectable()
export class AiService {
  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<Task>,
    private readonly planner: TaskPlanner,
    private readonly projectAccess: ProjectAccessService,
    private readonly tasks: TasksService,
  ) {}

  async suggestBreakdown(
    userId: string,
    projectId: string,
    goal: string,
  ): Promise<{ tasks: SuggestedTask[] }> {
    // Only people who could create the tasks may spend AI budget on them.
    const { project } = await this.projectAccess.authorize(
      userId,
      projectId,
      Permission.TASK_CREATE,
    );
    const existing = await this.taskModel
      .find({ project: project._id, parentTask: null, deletedAt: null })
      .select('title')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean<TaskRecord[]>()
      .exec();

    const tasks = await this.planner.breakDown({
      goal,
      projectName: project.name,
      existingTaskTitles: existing.map((t) => t.title),
    });
    return { tasks };
  }

  async applyBreakdown(
    userId: string,
    projectId: string,
    dto: ApplyBreakdownDto,
  ): Promise<TaskView[]> {
    const created: TaskView[] = [];
    // Sequential on purpose: keeps positions in the suggested order.
    for (const draft of dto.tasks) {
      const parent = await this.tasks.create(userId, projectId, {
        title: draft.title,
        description: draft.description,
        priority: draft.priority,
      });
      for (const subtask of draft.subtasks) {
        await this.tasks.create(userId, projectId, {
          title: subtask.title,
          parentTaskId: String(parent._id),
        });
      }
      created.push(parent);
    }
    return created;
  }
}
