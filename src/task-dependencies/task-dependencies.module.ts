import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Task, TaskSchema } from '../tasks/schemas/task.schema';
import { TasksModule } from '../tasks/tasks.module';
import {
  TaskDependency,
  TaskDependencySchema,
} from './schemas/task-dependency.schema';
import { TaskDependenciesController } from './task-dependencies.controller';
import { TaskDependenciesService } from './task-dependencies.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TaskDependency.name, schema: TaskDependencySchema },
      { name: Task.name, schema: TaskSchema },
    ]),
    TasksModule,
  ],
  controllers: [TaskDependenciesController],
  providers: [TaskDependenciesService],
})
export class TaskDependenciesModule {}
