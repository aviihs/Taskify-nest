import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Task, TaskSchema } from '../tasks/schemas/task.schema';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { ProjectAccessService } from './project-access.service';
import { ProjectMembersService } from './project-members.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { Project, ProjectSchema } from './schemas/project.schema';
import {
  ProjectMember,
  ProjectMemberSchema,
} from './schemas/project-member.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Project.name, schema: ProjectSchema },
      { name: ProjectMember.name, schema: ProjectMemberSchema },
      // Read-only use for progress stats; the Task model is owned by TasksModule.
      { name: Task.name, schema: TaskSchema },
    ]),
    WorkspacesModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectMembersService, ProjectAccessService],
  exports: [ProjectsService, ProjectAccessService],
})
export class ProjectsModule {}
