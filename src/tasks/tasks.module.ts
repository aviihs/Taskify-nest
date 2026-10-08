import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LabelsModule } from '../labels/labels.module';
import { ProjectsModule } from '../projects/projects.module';
import { MyTasksService } from './my-tasks.service';
import { Task, TaskSchema } from './schemas/task.schema';
import { TaskAccessService } from './task-access.service';
import { TaskCleanupListener } from './task-cleanup.listener';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Task.name, schema: TaskSchema }]),
    ProjectsModule,
    LabelsModule,
  ],
  controllers: [TasksController],
  providers: [
    TasksService,
    MyTasksService,
    TaskAccessService,
    TaskCleanupListener,
  ],
  exports: [TasksService, TaskAccessService],
})
export class TasksModule {}
