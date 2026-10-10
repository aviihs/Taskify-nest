import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthUser, JwtPayload } from '../types/auth-user';

export function extractBearerToken(header?: string): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

/**
 * Global authentication guard. Verifies the access token and attaches a
 * normalised AuthUser to the request. Refresh tokens are rejected here so a
 * long-lived refresh token can never be used as an access token.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('Authorization header is missing');
    }

    const user = this.verifyAccessToken(token);
    if (!user) throw new UnauthorizedException('Invalid or expired token');

    request.user = user;
    return true;
  }

  /** Shared with the realtime gateway so both transports authenticate identically. */
  verifyAccessToken(token: string): AuthUser | null {
    try {
      const payload = this.jwtService.verify<JwtPayload>(token);
      if (payload.typ === 'refresh') return null;
      return {
        id: String(payload.sub ?? payload.id),
        username: payload.username,
        roles: payload.roles,
      };
    } catch {
      return null;
    }
  }
}
