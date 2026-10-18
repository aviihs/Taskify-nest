import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserSchema, UserSchemaName } from '../users/schemas/user.schema';
import { PresenceService } from './presence.service';
import {
  PresenceSession,
  PresenceSessionSchema,
} from './schemas/presence-session.schema';

/** Who is online. Standalone so chat and workspaces can both read it without importing each other. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PresenceSession.name, schema: PresenceSessionSchema },
      { name: UserSchemaName, schema: UserSchema },
    ]),
  ],
  providers: [PresenceService],
  exports: [PresenceService],
})
export class PresenceModule {}
