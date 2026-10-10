import { TaskPriority } from '../tasks/schemas/task.schema';

export interface SuggestedSubtask {
  title: string;
}

export interface SuggestedTask {
  title: string;
  description: string;
  priority: TaskPriority;
  subtasks: SuggestedSubtask[];
}

export interface PlanContext {
  goal: string;
  projectName: string;
  /** Titles already in the project, so suggestions don't duplicate them. */
  existingTaskTitles: string[];
}

/**
 * Port for AI task planning. The domain never depends on a vendor SDK;
 * swap the implementation in AiModule.
 */
export abstract class TaskPlanner {
  abstract breakDown(context: PlanContext): Promise<SuggestedTask[]>;
}
