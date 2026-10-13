import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { UsersModule } from '../users/users.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { jwtConstants } from './constants';
import { FirebaseTokenVerifier } from './social/firebase-token.verifier';
import {
  UserIdentity,
  UserIdentitySchema,
} from './social/user-identity.schema';

@Module({
  imports: [
    UsersModule,
    WorkspacesModule,
    MongooseModule.forFeature([
      { name: UserIdentity.name, schema: UserIdentitySchema },
    ]),
    JwtModule.register({
      secret: jwtConstants.secret,
      signOptions: { expiresIn: '1h' },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    FirebaseTokenVerifier,
    JwtAuthGuard,
    // Every route requires a valid access token unless marked @Public().
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
  ],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
