import { Db } from '../migrations/migration';
import { APP_COLLECTIONS } from '../models';

/** A filter or pipeline stage (mongodb is only a transitive dependency). */
type Document = Record<string, unknown>;

/**
 * Read-only referential integrity checks. Every check only runs `find`,
 * `aggregate` (no `$out`/`$merge`) or `countDocuments`, so the whole suite is
 * safe against any database. Shared by `db:check` and data-repair dry runs.
 */

export type Severity = 'error' | 'warning' | 'info';

export interface Finding {
  check: string;
  collection: string;
  severity: Severity;
  description: string;
  /** `_id`s of the offending documents (all of them, not a sample). */
  ids: string[];
}

export interface IntegrityReport {
  collections: Record<string, number>;
  /** Collections present in the database that no schema in the code owns. */
  unmanagedCollections: string[];
  findings: Finding[];
}

interface Check {
  id: string;
  collection: string;
  severity: Severity;
  description: string;
  run(db: Db): Promise<string[]>;
}

const idsOf = async (db: Db, collection: string, pipeline: Document[]) =>
  (
    await db
      .collection(collection)
      .aggregate<{ _id: unknown }>([...pipeline, { $project: { _id: 1 } }])
      .toArray()
  ).map((d) => String(d._id));

/** Joins `from` on `_id = $<field>` keeping only the projected fields. */
const lookupById = (
  field: string,
  from: string,
  as: string,
  project: Record<string, 1> = { _id: 1 },
): Document => ({
  $lookup: {
    from,
    let: { ref: `$${field}` },
    pipeline: [
      { $match: { $expr: { $eq: ['$_id', '$$ref'] } } },
      { $project: project },
    ],
    as,
  },
});

interface RefOptions {
  severity?: Severity;
  array?: boolean;
  filter?: Document;
  note?: string;
}

/** Documents whose `field` (or any element, for arrays) points at no document in `target`. */
function missingRef(
  collection: string,
  field: string,
  target: string,
  { severity = 'error', array = false, filter = {}, note }: RefOptions = {},
): Check {
  return {
    id: `${collection}.${field}${
      filter.entityType ? `(${filter.entityType})` : ''
    }->${target}`,
    collection,
    severity,
    description: `${field} references a missing ${target} document${
      note ? ` (${note})` : ''
    }`,
    run: (db) =>
      idsOf(db, collection, [
        { $match: { ...filter, [field]: { $exists: true, $ne: null } } },
        ...(array ? [{ $unwind: `$${field}` }] : []),
        lookupById(field, target, '__ref'),
        { $match: { __ref: { $size: 0 } } },
        { $group: { _id: '$_id' } },
      ]),
  };
}

/** Copied scope fields (`[childField, parentField]`) that differ from the parent's. */
function scopeMismatch(
  collection: string,
  parentField: string,
  parent: string,
  pairs: Array<[string, string]>,
): Check {
  return {
    id: `${collection}.scope-vs-${parentField}`,
    collection,
    severity: 'error',
    description: `${pairs
      .map(([c]) => c)
      .join('/')} differs from the ${parentField}'s ${pairs
      .map(([, p]) => p)
      .join('/')}`,
    run: (db) =>
      idsOf(db, collection, [
        { $match: { [parentField]: { $ne: null } } },
        lookupById(
          parentField,
          parent,
          '__p',
          Object.fromEntries(pairs.map(([, p]) => [p, 1])),
        ),
        { $unwind: '$__p' },
        {
          $match: {
            $expr: {
              $or: pairs.map(([c, p]) => ({ $ne: [`$${c}`, `$__p.${p}`] })),
            },
          },
        },
      ]),
  };
}

/** Every document in a group that shares the same key (what a unique index forbids). */
function duplicates(
  collection: string,
  description: string,
  key: Document,
  filter: Document = {},
): Check {
  return {
    id: `${collection}.duplicate(${Object.keys(key).join(',')})`,
    collection,
    severity: 'error',
    description,
    run: async (db) =>
      (
        await db
          .collection(collection)
          .aggregate<{ ids: unknown[] }>([
            { $match: filter },
            { $group: { _id: key, ids: { $push: '$_id' }, n: { $sum: 1 } } },
            { $match: { n: { $gt: 1 } } },
          ])
          .toArray()
      ).flatMap((g) => g.ids.map(String)),
  };
}

function legacyShape(
  collection: string,
  description: string,
  filter: Document,
): Check {
  return {
    id: `${collection}.legacy(${Object.keys(filter).join(',')})`,
    collection,
    severity: 'warning',
    description,
    run: async (db) =>
      (
        await db
          .collection(collection)
          .find(filter, { projection: { _id: 1 } })
          .toArray()
      ).map((d) => String(d._id)),
  };
}

const lower = (field: string) => ({
  $toLower: { $trim: { input: `$${field}` } },
});

/** Joins the ACTIVE membership of (`$<workspaceField>`, `$<userField>`). */
const lookupActiveMembership = (
  workspaceField: string,
  userField: string,
): Document => ({
  $lookup: {
    from: 'workspace_members',
    let: { w: `$${workspaceField}`, u: `$${userField}` },
    pipeline: [
      {
        $match: {
          $expr: {
            $and: [
              { $eq: ['$workspace', '$$w'] },
              { $eq: ['$user', '$$u'] },
              { $eq: ['$status', 'ACTIVE'] },
            ],
          },
        },
      },
      { $project: { _id: 1 } },
    ],
    as: '__m',
  },
});

const CHECKS: Check[] = [
  // users
  duplicates('users', 'email is not unique (case-insensitive)', lower('email')),
  duplicates(
    'users',
    'userName is not unique (case-insensitive)',
    lower('userName'),
  ),
  {
    id: 'users.no-personal-workspace',
    collection: 'users',
    severity: 'warning',
    description:
      'active account has no personal workspace (recreated lazily on GET /workspaces)',
    run: (db) =>
      idsOf(db, 'users', [
        { $match: { deletedAt: null } },
        {
          $lookup: {
            from: 'workspaces',
            let: { u: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$owner', '$$u'] },
                      { $eq: ['$type', 'PERSONAL'] },
                    ],
                  },
                },
              },
              { $project: { _id: 1 } },
            ],
            as: '__w',
          },
        },
        { $match: { __w: { $size: 0 } } },
      ]),
  },

  legacyShape('users', '`isDeleted` flag from before migration 003', {
    isDeleted: { $exists: true },
  }),

  // workspaces
  missingRef('workspaces', 'owner', 'users'),
  duplicates(
    'workspaces',
    'owner has more than one personal workspace',
    { owner: '$owner' },
    { type: 'PERSONAL' },
  ),
  {
    id: 'workspaces.owner-membership',
    collection: 'workspaces',
    severity: 'error',
    description:
      'does not have exactly one OWNER membership belonging to workspace.owner',
    run: (db) =>
      idsOf(db, 'workspaces', [
        {
          $lookup: {
            from: 'workspace_members',
            let: { w: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$workspace', '$$w'] },
                      { $eq: ['$role', 'OWNER'] },
                    ],
                  },
                },
              },
              { $project: { user: 1 } },
            ],
            as: '__owners',
          },
        },
        {
          $match: {
            $expr: {
              $or: [
                { $ne: [{ $size: '$__owners' }, 1] },
                { $ne: [{ $first: '$__owners.user' }, '$owner'] },
              ],
            },
          },
        },
      ]),
  },
  {
    id: 'workspaces.personal-has-other-members',
    collection: 'workspaces',
    severity: 'error',
    description: 'personal workspace has members other than its owner',
    run: (db) =>
      idsOf(db, 'workspaces', [
        { $match: { type: 'PERSONAL' } },
        {
          $lookup: {
            from: 'workspace_members',
            let: { w: '$_id', o: '$owner' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$workspace', '$$w'] },
                      { $ne: ['$user', '$$o'] },
                    ],
                  },
                },
              },
              { $project: { _id: 1 } },
            ],
            as: '__m',
          },
        },
        { $match: { '__m.0': { $exists: true } } },
      ]),
  },

  // workspace_members
  missingRef('workspace_members', 'workspace', 'workspaces'),
  missingRef('workspace_members', 'user', 'users'),
  duplicates('workspace_members', 'duplicate (workspace, user) membership', {
    w: '$workspace',
    u: '$user',
  }),

  // workspaceinvitations
  missingRef('workspace_invitations', 'workspace', 'workspaces'),
  missingRef('workspace_invitations', 'invitedBy', 'users', {
    severity: 'warning',
  }),
  duplicates(
    'workspace_invitations',
    'more than one PENDING invitation per (workspace, email)',
    { w: '$workspace', e: lower('email') },
    { status: 'PENDING' },
  ),

  // projects
  missingRef('projects', 'workspace', 'workspaces'),
  missingRef('projects', 'createdBy', 'users', { severity: 'warning' }),
  legacyShape('projects', 'pre-workspace project (no workspace field)', {
    workspace: { $exists: false },
  }),

  // project_members
  missingRef('project_members', 'project', 'projects'),
  missingRef('project_members', 'workspace', 'workspaces'),
  missingRef('project_members', 'user', 'users'),
  scopeMismatch('project_members', 'project', 'projects', [
    ['workspace', 'workspace'],
  ]),
  duplicates('project_members', 'duplicate (project, user) membership', {
    p: '$project',
    u: '$user',
  }),
  {
    id: 'project_members.user-not-active-member',
    collection: 'project_members',
    severity: 'warning',
    description: 'user is not an ACTIVE member of the project’s workspace',
    run: (db) =>
      idsOf(db, 'project_members', [
        lookupActiveMembership('workspace', 'user'),
        { $match: { __m: { $size: 0 } } },
      ]),
  },

  // tasks
  missingRef('tasks', 'project', 'projects'),
  missingRef('tasks', 'workspace', 'workspaces'),
  missingRef('tasks', 'parentTask', 'tasks'),
  missingRef('tasks', 'createdBy', 'users', { severity: 'warning' }),
  missingRef('tasks', 'assignees', 'users', { array: true }),
  missingRef('tasks', 'labels', 'labels', { array: true }),
  scopeMismatch('tasks', 'project', 'projects', [['workspace', 'workspace']]),
  scopeMismatch('tasks', 'parentTask', 'tasks', [['project', 'project']]),
  {
    id: 'tasks.label-other-workspace',
    collection: 'tasks',
    severity: 'error',
    description: 'has a label from another workspace',
    run: (db) =>
      idsOf(db, 'tasks', [
        { $unwind: '$labels' },
        lookupById('labels', 'labels', '__l', { workspace: 1 }),
        { $unwind: '$__l' },
        { $match: { $expr: { $ne: ['$workspace', '$__l.workspace'] } } },
        { $group: { _id: '$_id' } },
      ]),
  },
  {
    id: 'tasks.nested-subtask',
    collection: 'tasks',
    severity: 'error',
    description: 'parent task is itself a subtask (only one level allowed)',
    run: (db) =>
      idsOf(db, 'tasks', [
        { $match: { parentTask: { $ne: null } } },
        lookupById('parentTask', 'tasks', '__p', { parentTask: 1 }),
        {
          $match: {
            '__p.parentTask': { $ne: null },
            '__p.0': { $exists: true },
          },
        },
      ]),
  },
  {
    id: 'tasks.assignee-not-active-member',
    collection: 'tasks',
    severity: 'warning',
    description:
      'live task has an assignee who is not an ACTIVE workspace member',
    run: (db) =>
      idsOf(db, 'tasks', [
        { $match: { deletedAt: null } },
        { $unwind: '$assignees' },
        lookupActiveMembership('workspace', 'assignees'),
        { $match: { __m: { $size: 0 } } },
        { $group: { _id: '$_id' } },
      ]),
  },
  {
    id: 'tasks.live-in-deleted-project',
    collection: 'tasks',
    severity: 'info',
    description:
      'live task in a soft-deleted project (hidden by access checks; by design)',
    run: (db) =>
      idsOf(db, 'tasks', [
        { $match: { deletedAt: null } },
        lookupById('project', 'projects', '__p', { deletedAt: 1 }),
        { $unwind: '$__p' },
        { $match: { '__p.deletedAt': { $ne: null } } },
      ]),
  },
  legacyShape('tasks', 'single `assignee` field from before migration 002', {
    assignee: { $exists: true },
  }),
  legacyShape('tasks', 'pre-workspace task (no workspace field)', {
    workspace: { $exists: false },
  }),

  // labels
  missingRef('labels', 'workspace', 'workspaces'),
  missingRef('labels', 'createdBy', 'users', { severity: 'warning' }),
  duplicates(
    'labels',
    'duplicate label name within a workspace (case-insensitive)',
    { w: '$workspace', n: lower('name') },
  ),

  // task_dependencies
  missingRef('task_dependencies', 'blockingTask', 'tasks'),
  missingRef('task_dependencies', 'blockedTask', 'tasks'),
  missingRef('task_dependencies', 'project', 'projects'),
  scopeMismatch('task_dependencies', 'blockingTask', 'tasks', [
    ['project', 'project'],
  ]),
  scopeMismatch('task_dependencies', 'blockedTask', 'tasks', [
    ['project', 'project'],
  ]),
  {
    id: 'task_dependencies.self-loop',
    collection: 'task_dependencies',
    severity: 'error',
    description: 'task depends on itself',
    run: (db) =>
      idsOf(db, 'task_dependencies', [
        { $match: { $expr: { $eq: ['$blockingTask', '$blockedTask'] } } },
      ]),
  },
  duplicates('task_dependencies', 'duplicate dependency edge', {
    a: '$blockingTask',
    b: '$blockedTask',
  }),

  // comments
  missingRef('comments', 'task', 'tasks'),
  missingRef('comments', 'workspace', 'workspaces'),
  missingRef('comments', 'project', 'projects'),
  missingRef('comments', 'author', 'users', { severity: 'warning' }),
  missingRef('comments', 'parentComment', 'comments'),
  scopeMismatch('comments', 'task', 'tasks', [
    ['workspace', 'workspace'],
    ['project', 'project'],
  ]),
  scopeMismatch('comments', 'parentComment', 'comments', [['task', 'task']]),
  legacyShape('comments', 'legacy soft-delete flag', {
    isDeleted: { $exists: true },
  }),

  // attachments
  missingRef('attachments', 'task', 'tasks'),
  missingRef('attachments', 'workspace', 'workspaces'),
  missingRef('attachments', 'project', 'projects'),
  missingRef('attachments', 'uploadedBy', 'users', { severity: 'warning' }),
  scopeMismatch('attachments', 'task', 'tasks', [
    ['workspace', 'workspace'],
    ['project', 'project'],
  ]),
  legacyShape('attachments', 'legacy shape without storageKey', {
    storageKey: { $exists: false },
  }),

  // notifications
  missingRef('notifications', 'recipient', 'users'),
  missingRef('notifications', 'workspace', 'workspaces'),
  missingRef('notifications', 'actor', 'users', { severity: 'warning' }),
  missingRef('notifications', 'entityId', 'tasks', {
    filter: { entityType: 'task' },
  }),
  missingRef('notifications', 'entityId', 'projects', {
    filter: { entityType: 'project' },
  }),
  missingRef('notifications', 'entityId', 'workspace_invitations', {
    filter: { entityType: 'invitation' },
  }),
  legacyShape('notifications', 'legacy shape without recipient', {
    recipient: { $exists: false },
  }),

  // activity_logs: append-only history, kept by policy even when parents are gone.
  missingRef('activity_logs', 'workspace', 'workspaces', {
    severity: 'info',
    note: 'historical, retained',
  }),
  missingRef('activity_logs', 'project', 'projects', {
    severity: 'info',
    note: 'historical, retained',
  }),
  missingRef('activity_logs', 'task', 'tasks', {
    severity: 'info',
    note: 'historical, retained',
  }),
  missingRef('activity_logs', 'actor', 'users', {
    severity: 'info',
    note: 'historical, retained',
  }),
  scopeMismatch('activity_logs', 'project', 'projects', [
    ['workspace', 'workspace'],
  ]),
];

/** Runs every check against the collections that exist. Never writes. */
export async function runIntegrityChecks(db: Db): Promise<IntegrityReport> {
  const names = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((name) => !name.startsWith('system.'))
    .sort();
  const present = new Set(names);

  const collections: Record<string, number> = {};
  for (const name of names) {
    collections[name] = await db.collection(name).countDocuments();
  }

  const findings: Finding[] = [];
  for (const check of CHECKS) {
    // A check on an absent collection has nothing to report.
    if (!present.has(check.collection)) continue;
    const ids = await check.run(db);
    if (!ids.length) continue;
    findings.push({
      check: check.id,
      collection: check.collection,
      severity: check.severity,
      description: check.description,
      ids,
    });
  }

  return {
    collections,
    unmanagedCollections: names.filter(
      (name) => !APP_COLLECTIONS.includes(name),
    ),
    findings,
  };
}
