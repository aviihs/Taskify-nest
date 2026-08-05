import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TaskModule } from './task/task.module';
import { AuthModule } from './auth/auth.module';
// import { UsersModule } from './users/users.module';
// import { ProjectModule } from './project/project.module';
// import { TeamModule } from './team/team.module';
// import { CommentsModule } from './comments/comments.module';
// import { AttachmentsModule } from './attachments/attachments.module';
// import { NotificationsModule } from './notifications/notifications.module';
// import { ActivityModule } from './activity/activity.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { PermissionsService } from './common/permissions/permissions.service';
import { PermissionsGuard } from './common/guards/permissions.guard';

@Module({
  imports: [
    TaskModule,
    AuthModule,
    // UsersModule,
    // ProjectModule,
    // TeamModule,
    // CommentsModule,
    // AttachmentsModule,
    // NotificationsModule,
    // ActivityModule,
    DatabaseModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    PermissionsService,
    PermissionsGuard,
  ],
})
export class AppModule {}
