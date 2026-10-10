import { Model, Types } from 'mongoose';
import { Task, TaskStatus } from './schemas/task.schema';

export interface Progress {
  total: number;
  completed: number;
  /** 0–100, rounded. 0 when there is nothing to complete. */
  percent: number;
}

const toProgress = (total: number, completed: number): Progress => ({
  total,
  completed,
  percent: total ? Math.round((completed / total) * 100) : 0,
});

export const EMPTY_PROGRESS: Progress = toProgress(0, 0);

/**
 * Counts live tasks grouped by `groupField` in a single aggregation.
 * Used for project progress (top-level tasks per project) and subtask
 * progress (children per parent) without N+1 queries.
 */
export async function progressBy(
  taskModel: Model<Task>,
  groupField: 'project' | 'parentTask',
  ids: Types.ObjectId[],
): Promise<Map<string, Progress>> {
  if (!ids.length) return new Map();
  const match: Record<string, unknown> = {
    [groupField]: { $in: ids },
    deletedAt: null,
  };
  if (groupField === 'project') match.parentTask = null;

  const rows = await taskModel
    .aggregate<{ _id: Types.ObjectId; total: number; completed: number }>([
      { $match: match },
      {
        $group: {
          _id: `$${groupField}`,
          total: { $sum: 1 },
          completed: {
            $sum: { $cond: [{ $eq: ['$status', TaskStatus.DONE] }, 1, 0] },
          },
        },
      },
    ])
    .exec();
  return new Map(
    rows.map((r) => [String(r._id), toProgress(r.total, r.completed)]),
  );
}
