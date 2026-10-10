/**
 * Identity attached to `request.user` by JwtAuthGuard.
 * `roles` is the platform-level role (ADMIN/USER) — never a workspace role.
 * Workspace roles live on WorkspaceMember and are resolved per request.
 */
export interface AuthUser {
  id: string;
  username: string;
  roles: string;
}

export type TokenType = 'access' | 'refresh';

export interface JwtPayload {
  sub: string;
  id: string;
  username: string;
  roles: string;
  iss: string;
  typ?: TokenType;
}
