import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProjectsModule } from '../projects/projects.module';
import { Task, TaskSchema } from '../tasks/schemas/task.schema';
import { TasksModule } from '../tasks/tasks.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { ClaudeTaskPlanner } from './claude-task-planner';
import { TaskPlanner } from './task-planner';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Task.name, schema: TaskSchema }]),
    ProjectsModule,
    TasksModule,
  ],
  controllers: [AiController],
  providers: [AiService, { provide: TaskPlanner, useClass: ClaudeTaskPlanner }],
})
export class AiModule {}
