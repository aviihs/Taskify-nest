import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { Task, TaskRecord, TaskStatus } from '../tasks/schemas/task.schema';
import { NotificationsService } from './notifications.service';
import { NotificationType } from './schemas/user-notification.schema';

const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 200;

/** Notifies every assignee once when an open task is due within 24 hours. */
@Injectable()
export class DueDateReminderScheduler {
  private readonly logger = new Logger(DueDateReminderScheduler.name);

  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<Task>,
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
              'assignees.0': { $exists: true },
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

        // `notify` skips assignees who lost access (or whose project/workspace was deleted).
        const created = await this.notifications.notify({
          recipientIds: task.assignees.map(String),
          type: NotificationType.TASK_DUE_SOON,
          message: `"${task.title}" is due soon`,
          workspaceId: String(task.workspace),
          projectId: String(task.project),
          entityType: 'task',
          entityId: String(task._id),
          link: `/tasks/${task._id}`,
        });
        if (created) sent++;
        if (sent >= BATCH_SIZE) break;
      }
    } catch (error) {
      this.logger.error('Due date reminder run failed', error);
    }
    return sent;
  }
}
