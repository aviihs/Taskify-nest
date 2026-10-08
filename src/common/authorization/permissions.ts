/**
 * Workspace-scoped RBAC.
 *
 * A user's role is stored on WorkspaceMember (one per workspace), so the same
 * user can be OWNER of their personal workspace and MEMBER elsewhere.
 * Code checks permissions, never role names.
 */
export enum WorkspaceRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MANAGER = 'MANAGER',
  MEMBER = 'MEMBER',
  VIEWER = 'VIEWER',
}

export enum Permission {
  WORKSPACE_READ = 'workspace:read',
  WORKSPACE_UPDATE = 'workspace:update',
  WORKSPACE_DELETE = 'workspace:delete',

  MEMBER_READ = 'member:read',
  MEMBER_INVITE = 'member:invite',
  MEMBER_UPDATE = 'member:update',
  MEMBER_REMOVE = 'member:remove',

  PROJECT_CREATE = 'project:create',
  PROJECT_READ = 'project:read',
  /** See every project in the workspace, not only the ones you are a member of. */
  PROJECT_READ_ALL = 'project:read_all',
  PROJECT_UPDATE = 'project:update',
  PROJECT_DELETE = 'project:delete',
  PROJECT_MANAGE_MEMBERS = 'project:manage_members',

  TASK_CREATE = 'task:create',
  TASK_READ = 'task:read',
  TASK_UPDATE = 'task:update',
  TASK_DELETE = 'task:delete',
  TASK_ASSIGN = 'task:assign',

  COMMENT_CREATE = 'comment:create',
  /** Moderate (edit/delete) other people's comments. Authors can always manage their own. */
  COMMENT_MODERATE = 'comment:moderate',

  LABEL_MANAGE = 'label:manage',

  ATTACHMENT_UPLOAD = 'attachment:upload',
  /** Delete other people's attachments. Uploaders can always delete their own. */
  ATTACHMENT_MODERATE = 'attachment:moderate',

  ACTIVITY_READ = 'activity:read',
}

const VIEWER: Permission[] = [
  Permission.WORKSPACE_READ,
  Permission.MEMBER_READ,
  Permission.PROJECT_READ,
  Permission.TASK_READ,
  Permission.COMMENT_CREATE,
  Permission.ACTIVITY_READ,
];

const MEMBER: Permission[] = [
  ...VIEWER,
  Permission.TASK_CREATE,
  Permission.TASK_UPDATE,
  Permission.TASK_ASSIGN,
  Permission.ATTACHMENT_UPLOAD,
];

const MANAGER: Permission[] = [
  ...MEMBER,
  Permission.PROJECT_CREATE,
  Permission.PROJECT_READ_ALL,
  Permission.PROJECT_UPDATE,
  Permission.PROJECT_MANAGE_MEMBERS,
  Permission.TASK_DELETE,
  Permission.LABEL_MANAGE,
  Permission.COMMENT_MODERATE,
  Permission.ATTACHMENT_MODERATE,
];

const ADMIN: Permission[] = [
  ...MANAGER,
  Permission.WORKSPACE_UPDATE,
  Permission.MEMBER_INVITE,
  Permission.MEMBER_UPDATE,
  Permission.MEMBER_REMOVE,
  Permission.PROJECT_DELETE,
];

const OWNER: Permission[] = [...ADMIN, Permission.WORKSPACE_DELETE];

export const ROLE_PERMISSIONS: Readonly<
  Record<WorkspaceRole, ReadonlySet<Permission>>
> = {
  [WorkspaceRole.OWNER]: new Set(OWNER),
  [WorkspaceRole.ADMIN]: new Set(ADMIN),
  [WorkspaceRole.MANAGER]: new Set(MANAGER),
  [WorkspaceRole.MEMBER]: new Set(MEMBER),
  [WorkspaceRole.VIEWER]: new Set(VIEWER),
};

export function roleHasPermission(
  role: WorkspaceRole,
  permission: Permission,
): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

const ROLE_RANK: Record<WorkspaceRole, number> = {
  [WorkspaceRole.OWNER]: 4,
  [WorkspaceRole.ADMIN]: 3,
  [WorkspaceRole.MANAGER]: 2,
  [WorkspaceRole.MEMBER]: 1,
  [WorkspaceRole.VIEWER]: 0,
};

/**
 * An actor may only manage members ranked strictly below them, and may only
 * grant roles strictly below their own (OWNER may grant ADMIN; nobody grants OWNER).
 */
export function canManageRole(
  actor: WorkspaceRole,
  target: WorkspaceRole,
): boolean {
  return ROLE_RANK[actor] > ROLE_RANK[target];
}
