import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from '../types/auth-user';

/** Injects the user resolved by JwtAuthGuard. Never re-verifies the token. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser =>
    context.switchToHttp().getRequest().user,
);
