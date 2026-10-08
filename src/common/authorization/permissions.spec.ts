import {
  canManageRole,
  Permission,
  roleHasPermission,
  WorkspaceRole,
} from './permissions';

describe('workspace permissions', () => {
  const { OWNER, ADMIN, MANAGER, MEMBER, VIEWER } = WorkspaceRole;

  it('gives every role read access', () => {
    for (const role of Object.values(WorkspaceRole)) {
      expect(roleHasPermission(role, Permission.TASK_READ)).toBe(true);
    }
  });

  it('reserves destructive actions for higher roles', () => {
    expect(roleHasPermission(OWNER, Permission.WORKSPACE_DELETE)).toBe(true);
    expect(roleHasPermission(ADMIN, Permission.WORKSPACE_DELETE)).toBe(false);
    expect(roleHasPermission(ADMIN, Permission.MEMBER_INVITE)).toBe(true);
    expect(roleHasPermission(MANAGER, Permission.MEMBER_INVITE)).toBe(false);
    expect(roleHasPermission(MANAGER, Permission.TASK_DELETE)).toBe(true);
    expect(roleHasPermission(MEMBER, Permission.TASK_DELETE)).toBe(false);
    expect(roleHasPermission(VIEWER, Permission.TASK_UPDATE)).toBe(false);
  });

  it('is cumulative: each role includes everything below it', () => {
    const order = [VIEWER, MEMBER, MANAGER, ADMIN, OWNER];
    for (let i = 1; i < order.length; i++) {
      for (const permission of Object.values(Permission)) {
        if (roleHasPermission(order[i - 1], permission)) {
          expect(roleHasPermission(order[i], permission)).toBe(true);
        }
      }
    }
  });

  it('only allows managing strictly lower roles', () => {
    expect(canManageRole(OWNER, ADMIN)).toBe(true);
    expect(canManageRole(ADMIN, ADMIN)).toBe(false);
    expect(canManageRole(ADMIN, OWNER)).toBe(false);
    expect(canManageRole(MANAGER, MEMBER)).toBe(true);
  });
});
