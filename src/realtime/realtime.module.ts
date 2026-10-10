import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProjectsModule } from '../projects/projects.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [AuthModule, WorkspacesModule, ProjectsModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
