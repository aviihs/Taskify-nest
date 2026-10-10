import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProjectsModule } from '../projects/projects.module';
import { Task, TaskSchema } from '../tasks/schemas/task.schema';
import { DueDateReminderScheduler } from './due-date-reminder.scheduler';
import { NotificationRulesListener } from './notification-rules.listener';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import {
  Notification,
  NotificationSchema,
} from './schemas/user-notification.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      { name: Task.name, schema: TaskSchema },
    ]),
    ProjectsModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationRulesListener,
    DueDateReminderScheduler,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
