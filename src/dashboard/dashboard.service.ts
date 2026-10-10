import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Permission } from '../common/authorization/permissions';
import { dayBounds } from '../common/utils/query';
import { ProjectAccessService } from '../projects/project-access.service';
import { Project, ProjectRecord } from '../projects/schemas/project.schema';
import { Task, TaskPriority, TaskStatus } from '../tasks/schemas/task.schema';
import { EMPTY_PROGRESS, Progress, progressBy } from '../tasks/task-stats';
import { lookupPublicUser, PublicUser } from '../users/public-user';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';

export interface DashboardSummary {
  total: number;
  completed: number;
  inProgress: number;
  overdue: number;
  dueToday: number;
}

export interface WorkspaceDashboard {
  summary: DashboardSummary;
  byStatus: Record<TaskStatus, number>;
  openByPriority: Record<TaskPriority, number>;
  projects: Array<
    Pick<ProjectRecord, '_id' | 'name' | 'status' | 'dueDate'> & {
      progress: Progress;
    }
  >;
  workload: Array<{ user: PublicUser; open: number; overdue: number }>;
}

const zeroed = <K extends string>(keys: K[]): Record<K, number> =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

/**
 * Aggregates live task data for the projects the caller can see.
 * Summary/status/project numbers count top-level tasks; workload counts
 * every open assigned task (subtasks are real work too).
 */
@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<Task>,
    @InjectModel(Project.name) private readonly projectModel: Model<Project>,
    private readonly workspaceAccess: WorkspaceAccessService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async forWorkspace(
    userId: string,
    workspaceId: string,
    tzOffset = 0,
  ): Promise<WorkspaceDashboard> {
    const { workspace } = await this.workspaceAccess.authorize(
      userId,
      workspaceId,
      Permission.WORKSPACE_READ,
    );
    const projectIds = await this.projectAccess.accessibleProjectIds(userId, [
      workspace._id,
    ]);
    const { start, end } = dayBounds(tzOffset);

    const [taskStats, workload, projects, progress] = await Promise.all([
      this.taskStats(projectIds, start, end),
      this.workload(projectIds, start),
      this.projectModel
        .find({ _id: { $in: projectIds } })
        .select('name status dueDate')
        .sort({ name: 1 })
        .lean<ProjectRecord[]>()
        .exec(),
      progressBy(this.taskModel, 'project', projectIds),
    ]);

    return {
      ...taskStats,
      workload,
      projects: projects.map((p) => ({
        _id: p._id,
        name: p.name,
        status: p.status,
        dueDate: p.dueDate,
        progress: progress.get(String(p._id)) ?? EMPTY_PROGRESS,
      })),
    };
  }

  private async taskStats(
    projectIds: Types.ObjectId[],
    start: Date,
    end: Date,
  ): Promise<
    Pick<WorkspaceDashboard, 'summary' | 'byStatus' | 'openByPriority'>
  > {
    const open = { $ne: ['$status', TaskStatus.DONE] };
    const [facets] = await this.taskModel
      .aggregate([
        {
          $match: {
            project: { $in: projectIds },
            deletedAt: null,
            parentTask: null,
          },
        },
        {
          $facet: {
            summary: [
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  completed: {
                    $sum: {
                      $cond: [{ $eq: ['$status', TaskStatus.DONE] }, 1, 0],
                    },
                  },
                  inProgress: {
                    $sum: {
                      $cond: [
                        { $eq: ['$status', TaskStatus.IN_PROGRESS] },
                        1,
                        0,
                      ],
                    },
                  },
                  overdue: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            open,
                            { $ne: ['$dueDate', null] },
                            { $lt: ['$dueDate', start] },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  dueToday: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            open,
                            { $gte: ['$dueDate', start] },
                            { $lt: ['$dueDate', end] },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                },
              },
            ],
            byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
            openByPriority: [
              { $match: { status: { $ne: TaskStatus.DONE } } },
              { $group: { _id: '$priority', count: { $sum: 1 } } },
            ],
          },
        },
      ])
      .exec();

    const toRecord = <K extends string>(
      keys: K[],
      rows: Array<{ _id: K; count: number }>,
    ) => {
      const record = zeroed(keys);
      rows.forEach((r) => (record[r._id] = r.count));
      return record;
    };
    const [summary] = facets.summary;
    return {
      summary: {
        total: summary?.total ?? 0,
        completed: summary?.completed ?? 0,
        inProgress: summary?.inProgress ?? 0,
        overdue: summary?.overdue ?? 0,
        dueToday: summary?.dueToday ?? 0,
      },
      byStatus: toRecord(Object.values(TaskStatus), facets.byStatus),
      openByPriority: toRecord(
        Object.values(TaskPriority),
        facets.openByPriority,
      ),
    };
  }

  private workload(
    projectIds: Types.ObjectId[],
    startOfToday: Date,
  ): Promise<WorkspaceDashboard['workload']> {
    return this.taskModel
      .aggregate<WorkspaceDashboard['workload'][number]>([
        {
          $match: {
            project: { $in: projectIds },
            deletedAt: null,
            'assignees.0': { $exists: true },
            status: { $ne: TaskStatus.DONE },
          },
        },
        // A task shared by several people counts toward each one's workload.
        { $unwind: '$assignees' },
        {
          $group: {
            _id: '$assignees',
            open: { $sum: 1 },
            overdue: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ne: ['$dueDate', null] },
                      { $lt: ['$dueDate', startOfToday] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
        lookupPublicUser('_id', 'user'),
        { $unwind: '$user' },
        { $project: { _id: 0, user: 1, open: 1, overdue: 1 } },
        { $sort: { open: -1 } },
      ])
      .exec();
  }
}
