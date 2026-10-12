import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LabelsModule } from '../labels/labels.module';
import { ProjectsModule } from '../projects/projects.module';
import {
  TaskDependency,
  TaskDependencySchema,
} from '../task-dependencies/schemas/task-dependency.schema';
import { MyTasksService } from './my-tasks.service';
import { Task, TaskSchema } from './schemas/task.schema';
import { TaskAccessService } from './task-access.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Task.name, schema: TaskSchema },
      // Written only by the task-deletion cascade.
      { name: TaskDependency.name, schema: TaskDependencySchema },
    ]),
    ProjectsModule,
    LabelsModule,
  ],
  controllers: [TasksController],
  providers: [TasksService, MyTasksService, TaskAccessService],
  exports: [TasksService, TaskAccessService],
})
export class TasksModule {}
