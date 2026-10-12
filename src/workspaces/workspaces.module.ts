import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ProjectMember,
  ProjectMemberSchema,
} from '../projects/schemas/project-member.schema';
import { Task, TaskSchema } from '../tasks/schemas/task.schema';
import { Workspace, WorkspaceSchema } from './schemas/workspace.schema';
import {
  WorkspaceMember,
  WorkspaceMemberSchema,
} from './schemas/workspace-member.schema';
import { WorkspaceAccessService } from './workspace-access.service';
import { WorkspaceMembersService } from './workspace-members.service';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Workspace.name, schema: WorkspaceSchema },
      { name: WorkspaceMember.name, schema: WorkspaceMemberSchema },
      // Written only by the member-removal cascade.
      { name: ProjectMember.name, schema: ProjectMemberSchema },
      { name: Task.name, schema: TaskSchema },
    ]),
  ],
  controllers: [WorkspacesController],
  providers: [
    WorkspacesService,
    WorkspaceMembersService,
    WorkspaceAccessService,
  ],
  exports: [WorkspacesService, WorkspaceMembersService, WorkspaceAccessService],
})
export class WorkspacesModule {}
