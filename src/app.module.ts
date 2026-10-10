import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ActivityModule } from './activity/activity.module';
import { AiModule } from './ai/ai.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AttachmentsModule } from './attachments/attachments.module';
import { AuthModule } from './auth/auth.module';
import { CommentsModule } from './comments/comments.module';
import { CommonModule } from './common/common.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { InvitationsModule } from './invitations/invitations.module';
import { LabelsModule } from './labels/labels.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ProjectsModule } from './projects/projects.module';
import { RealtimeModule } from './realtime/realtime.module';
import { SearchModule } from './search/search.module';
import { TaskDependenciesModule } from './task-dependencies/task-dependencies.module';
import { TasksModule } from './tasks/tasks.module';
import { UsersModule } from './users/users.module';
import { WorkspacesModule } from './workspaces/workspaces.module';

@Module({
  imports: [
    DatabaseModule,
    CommonModule,
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    // ThrottlerModule.forRoot({ ttl: 60, limit: 120 }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 120,
      },
    ]),
    HealthModule,
    AuthModule,
    UsersModule,
    WorkspacesModule,
    InvitationsModule,
    ProjectsModule,
    LabelsModule,
    TasksModule,
    TaskDependenciesModule,
    CommentsModule,
    AttachmentsModule,
    ActivityModule,
    NotificationsModule,
    SearchModule,
    DashboardModule,
    RealtimeModule,
    AiModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // JwtAuthGuard is registered globally in AuthModule. RolesGuard is NOT
    // global: global guards from the root module run before AuthModule's, so
    // `request.user` would not exist yet and every admin route returned 403.
    // It is applied with @UseGuards on the platform-admin controllers instead,
    // which always run after the global JwtAuthGuard.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
