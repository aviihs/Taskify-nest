import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Comment,
  CommentSchema,
} from '../comments/schemas/task-comment.schema';
import { ProjectsModule } from '../projects/projects.module';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import { Task, TaskSchema } from '../tasks/schemas/task.schema';
import { UserSchema, UserSchemaName } from '../users/schemas/user.schema';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [
    // Read-only access to models owned by other modules.
    MongooseModule.forFeature([
      { name: Task.name, schema: TaskSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: UserSchemaName, schema: UserSchema },
    ]),
    WorkspacesModule,
    ProjectsModule,
  ],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
