import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import {
  WorkspaceInvitation,
  WorkspaceInvitationSchema,
} from './schemas/invitation.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: WorkspaceInvitation.name, schema: WorkspaceInvitationSchema },
    ]),
    UsersModule,
    WorkspacesModule,
  ],
  controllers: [InvitationsController],
  providers: [InvitationsService],
})
export class InvitationsModule {}
