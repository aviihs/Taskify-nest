import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PresenceModule } from '../chat/presence.module';
import { UserSchema, UserSchemaName } from './schemas/user.schema';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: UserSchemaName, schema: UserSchema }]),
    PresenceModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
