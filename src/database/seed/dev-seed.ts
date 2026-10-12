import * as bcrypt from 'bcryptjs';
import { Connection, Types } from 'mongoose';
import { WorkspaceRole } from '../../common/authorization/permissions';
import { MIGRATIONS } from '../migrations/run-migrations';
import { MODELS } from '../models';

/**
 * Deterministic development data: fixed ids, names and relationships, dates
 * relative to the moment of seeding. Every user's password is SEED_PASSWORD.
 * Written through the Mongoose models, so schema validation applies.
 */
export const SEED_PASSWORD = 'Password@123';

/** Readable fixed ids: `seedId(2, 1)` → `020000000000000000000001`. */
const seedId = (kind: number, n: number) =>
  new Types.ObjectId(
    kind.toString(16).padStart(2, '0') + n.toString(16).padStart(22, '0'),
  );

const DAY = 86_400_000;

const U = {
  alice: seedId(1, 1),
  bob: seedId(1, 2),
  carol: seedId(1, 3),
  dave: seedId(1, 4),
  erin: seedId(1, 5),
};
const W = {
  acme: seedId(2, 1),
  personal: (n: number) => seedId(2, 100 + n),
};
const P = {
  website: seedId(3, 1),
  mobile: seedId(3, 2),
  errands: seedId(3, 3),
};
const L = { bug: seedId(4, 1), feature: seedId(4, 2), design: seedId(4, 3) };
const T = {
  homepage: seedId(5, 1),
  hero: seedId(5, 2),
  footer: seedId(5, 3),
  contactForm: seedId(5, 4),
  launch: seedId(5, 5),
  push: seedId(5, 6),
  groceries: seedId(5, 7),
};
const C = { repro: seedId(6, 1), reply: seedId(6, 2) };

export interface SeedSummary {
  collections: Record<string, number>;
}

/**
 * Drops every collection in the connected database, recreates collections
 * and indexes for all models, marks every migration as applied (the data is
 * already in the current shape) and loads the seed. Destructive: only the
 * guarded `db:reset-dev` command and tests call this.
 */
export async function resetAndSeed(
  connection: Connection,
  now = new Date(),
): Promise<SeedSummary> {
  for (const { name } of await connection.db
    .listCollections({}, { nameOnly: true })
    .toArray()) {
    if (!name.startsWith('system.')) await connection.db.dropCollection(name);
  }

  const model = (name: string) => {
    const definition = MODELS.find((m) => m.name === name);
    return connection.models[name] ?? connection.model(name, definition.schema);
  };
  for (const { name } of MODELS) {
    await model(name).createCollection();
    await model(name).syncIndexes();
  }
  await connection.db
    .collection<{ _id: string; appliedAt: Date }>('_migrations')
    .insertMany(MIGRATIONS.map((m) => ({ _id: m.id, appliedAt: now })));

  const at = (days: number) => new Date(now.getTime() + days * DAY);
  const password = await bcrypt.hash(SEED_PASSWORD, 10);
  const people: Array<[keyof typeof U, string, string, string]> = [
    ['alice', 'Alice', 'Admin', 'ADMIN'],
    ['bob', 'Bob', 'Builder', 'USER'],
    ['carol', 'Carol', 'Chen', 'USER'],
    ['dave', 'Dave', 'Dev', 'USER'],
    ['erin', 'Erin', 'Viewer', 'USER'],
  ];

  await model('User').insertMany(
    people.map(([key, firstName, lastName, role]) => ({
      _id: U[key],
      firstName,
      lastName,
      email: `${key}@taskify.dev`,
      userName: key,
      password,
      role,
      isActive: true,
      isEmailVerified: true,
    })),
  );

  // Every user has a personal workspace; Acme is the shared organization.
  await model('Workspace').insertMany([
    ...people.map(([key], i) => ({
      _id: W.personal(i + 1),
      name: 'Personal',
      type: 'PERSONAL',
      owner: U[key],
    })),
    {
      _id: W.acme,
      name: 'Acme Inc',
      description: 'Seeded organization workspace',
      type: 'ORGANIZATION',
      owner: U.alice,
    },
  ]);
  const acmeRoles: Array<[keyof typeof U, WorkspaceRole, string | null]> = [
    ['alice', WorkspaceRole.OWNER, 'Founder'],
    ['bob', WorkspaceRole.ADMIN, 'Operations'],
    ['carol', WorkspaceRole.MANAGER, 'Product Manager'],
    ['dave', WorkspaceRole.MEMBER, 'Developer'],
    ['erin', WorkspaceRole.VIEWER, 'Stakeholder'],
  ];
  await model('WorkspaceMember').insertMany([
    ...people.map(([key], i) => ({
      workspace: W.personal(i + 1),
      user: U[key],
      role: WorkspaceRole.OWNER,
    })),
    ...acmeRoles.map(([key, role, title]) => ({
      workspace: W.acme,
      user: U[key],
      role,
      title,
      invitedBy: key === 'alice' ? null : U.alice,
    })),
  ]);
  await model('WorkspaceInvitation').create({
    workspace: W.acme,
    email: 'frank@taskify.dev',
    role: WorkspaceRole.MEMBER,
    invitedBy: U.bob,
    expiresAt: at(7),
  });

  await model('Project').insertMany([
    {
      _id: P.website,
      workspace: W.acme,
      name: 'Website Relaunch',
      description: 'New marketing site',
      startDate: at(-14),
      dueDate: at(30),
      createdBy: U.carol,
    },
    {
      _id: P.mobile,
      workspace: W.acme,
      name: 'Mobile App',
      createdBy: U.alice,
    },
    {
      _id: P.errands,
      workspace: W.personal(2),
      name: 'Errands',
      createdBy: U.bob,
    },
  ]);
  // Creators always; MEMBER/VIEWER roles only see projects they belong to.
  const projectMembers: Array<
    [Types.ObjectId, Types.ObjectId, keyof typeof U]
  > = [
    [P.website, W.acme, 'carol'],
    [P.website, W.acme, 'dave'],
    [P.website, W.acme, 'erin'],
    [P.mobile, W.acme, 'alice'],
    [P.mobile, W.acme, 'dave'],
    [P.errands, W.personal(2), 'bob'],
  ];
  await model('ProjectMember').insertMany(
    projectMembers.map(([project, workspace, key]) => ({
      project,
      workspace,
      user: U[key],
      addedBy: key === 'dave' || key === 'erin' ? U.carol : U[key],
    })),
  );

  await model('Label').insertMany([
    {
      _id: L.bug,
      workspace: W.acme,
      name: 'Bug',
      color: '#dc2626',
      createdBy: U.carol,
    },
    {
      _id: L.feature,
      workspace: W.acme,
      name: 'Feature',
      color: '#2563eb',
      createdBy: U.carol,
    },
    {
      _id: L.design,
      workspace: W.acme,
      name: 'Design',
      color: '#9333ea',
      createdBy: U.carol,
    },
  ]);

  const website = { workspace: W.acme, project: P.website };
  await model('Task').insertMany([
    {
      _id: T.homepage,
      ...website,
      title: 'Design homepage',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      assignees: [U.dave],
      labels: [L.design],
      createdBy: U.carol,
      startDate: at(-7),
      dueDate: at(3),
      position: 1,
    },
    {
      _id: T.hero,
      ...website,
      parentTask: T.homepage,
      title: 'Hero section',
      status: 'DONE',
      assignees: [U.dave],
      createdBy: U.carol,
      completedAt: at(-1),
      position: 1,
    },
    {
      _id: T.footer,
      ...website,
      parentTask: T.homepage,
      title: 'Footer',
      createdBy: U.carol,
      position: 2,
    },
    {
      _id: T.contactForm,
      ...website,
      title: 'Fix contact form',
      priority: 'URGENT',
      assignees: [U.carol, U.dave],
      labels: [L.bug],
      createdBy: U.carol,
      dueDate: at(-1),
      position: 2,
    },
    {
      _id: T.launch,
      ...website,
      title: 'Launch checklist',
      status: 'BLOCKED',
      createdBy: U.carol,
      dueDate: at(30),
      position: 3,
    },
    {
      _id: T.push,
      workspace: W.acme,
      project: P.mobile,
      title: 'Set up push notifications',
      assignees: [U.dave],
      labels: [L.feature],
      createdBy: U.alice,
      dueDate: at(14),
      position: 1,
    },
    {
      _id: T.groceries,
      workspace: W.personal(2),
      project: P.errands,
      title: 'Buy groceries',
      assignees: [U.bob],
      createdBy: U.bob,
      dueDate: at(1),
      position: 1,
    },
  ]);
  await model('TaskDependency').create({
    project: P.website,
    blockingTask: T.homepage,
    blockedTask: T.launch,
    createdBy: U.carol,
  });

  const contactForm = { task: T.contactForm, ...website };
  await model('Comment').insertMany([
    {
      _id: C.repro,
      ...contactForm,
      author: U.carol,
      content: 'Submitting the form returns a 500 on Safari.',
    },
    {
      _id: C.reply,
      ...contactForm,
      author: U.dave,
      content: 'Reproduced, fixing it now @carol',
      parentComment: C.repro,
      mentions: [U.carol],
    },
  ]);

  await model('Notification').insertMany([
    {
      recipient: U.dave,
      type: 'TASK_ASSIGNED',
      message: 'You were assigned "Fix contact form"',
      actor: U.carol,
      workspace: W.acme,
      entityType: 'task',
      entityId: T.contactForm,
      link: `/tasks/${T.contactForm}`,
    },
    {
      recipient: U.carol,
      type: 'MENTIONED',
      message: 'You were mentioned on "Fix contact form"',
      actor: U.dave,
      workspace: W.acme,
      entityType: 'task',
      entityId: T.contactForm,
      link: `/tasks/${T.contactForm}`,
    },
  ]);

  await model('ActivityLog').insertMany([
    {
      workspace: W.acme,
      project: P.website,
      task: null,
      actor: U.carol,
      action: 'project.created',
      entityType: 'project',
      entityId: P.website,
      metadata: { name: 'Website Relaunch' },
    },
    {
      workspace: W.acme,
      project: P.website,
      task: T.contactForm,
      actor: U.carol,
      action: 'task.created',
      entityType: 'task',
      entityId: T.contactForm,
      metadata: {
        title: 'Fix contact form',
        assigneeIds: [String(U.carol), String(U.dave)],
        parentTaskId: null,
      },
    },
    {
      workspace: W.acme,
      project: P.website,
      task: T.contactForm,
      actor: U.dave,
      action: 'comment.created',
      entityType: 'comment',
      entityId: C.reply,
      metadata: { taskTitle: 'Fix contact form' },
    },
  ]);

  const collections: Record<string, number> = {};
  for (const { name } of MODELS) {
    const m = model(name);
    collections[m.collection.collectionName] = await m.countDocuments();
  }
  return { collections };
}
