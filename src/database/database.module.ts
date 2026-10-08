import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { env } from '../common/config/env.config';

// Mongoose builds schema indexes on boot. Keep it on: uniqueness rules
// (one membership per user, one pending invite per email) rely on them.
@Module({
  imports: [MongooseModule.forRoot(env.mongoUri)],
})
export class DatabaseModule {}
