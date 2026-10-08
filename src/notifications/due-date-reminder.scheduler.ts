import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { ProjectAccessService } from '../projects/project-access.service';
import { Task, TaskRecord, TaskStatus } from '../tasks/schemas/task.schema';
import { NotificationsService } from './notifications.service';
import { NotificationType } from './schemas/user-notification.schema';

const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 200;

/** Notifies assignees once when an open task is due within 24 hours. */
@Injectable()
export class DueDateReminderScheduler {
  private readonly logger = new Logger(DueDateReminderScheduler.name);

  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<Task>,
    private readonly projectAccess: ProjectAccessService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async sendDueSoonReminders(now = new Date()): Promise<number> {
    let sent = 0;
    try {
      for (;;) {
        // Atomic claim per task: safe when several API instances run the cron.
        const task = await this.taskModel
          .findOneAndUpdate(
            {
              deletedAt: null,
              assignee: { $ne: null },
              status: { $ne: TaskStatus.DONE },
              dueReminderSentAt: null,
              dueDate: {
                $gt: now,
                $lte: new Date(now.getTime() + REMINDER_WINDOW_MS),
              },
            },
            { dueReminderSentAt: now },
            { new: true },
          )
          .lean<TaskRecord>()
          .exec();
        if (!task) break;

        // Skip tasks whose project/workspace was deleted or the assignee lost access.
        if (
          await this.projectAccess.canAccess(
            String(task.assignee),
            task.project,
          )
        ) {
          await this.notifications.notify({
            recipientIds: [String(task.assignee)],
            type: NotificationType.TASK_DUE_SOON,
            message: `"${task.title}" is due soon`,
            workspaceId: String(task.workspace),
            entityType: 'task',
            entityId: String(task._id),
            link: `/tasks/${task._id}`,
          });
          sent++;
        }
        if (sent >= BATCH_SIZE) break;
      }
    } catch (error) {
      this.logger.error('Due date reminder run failed', error);
    }
    return sent;
  }
}
