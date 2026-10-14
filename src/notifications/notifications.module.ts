import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProjectsModule } from '../projects/projects.module';
import { Task, TaskSchema } from '../tasks/schemas/task.schema';
import { DueDateReminderScheduler } from './due-date-reminder.scheduler';
import { NotificationRulesListener } from './notification-rules.listener';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushNotificationListener } from './push/push-notification.listener';
import { PushService } from './push/push.service';
import { DeviceToken, DeviceTokenSchema } from './schemas/device-token.schema';
import {
  Notification,
  NotificationSchema,
} from './schemas/user-notification.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      { name: Task.name, schema: TaskSchema },
      { name: DeviceToken.name, schema: DeviceTokenSchema },
    ]),
    ProjectsModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationRulesListener,
    DueDateReminderScheduler,
    PushService,
    PushNotificationListener,
  ],
  exports: [NotificationsService, PushService],
})
export class NotificationsModule {}
