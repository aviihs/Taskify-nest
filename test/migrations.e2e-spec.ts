import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { runMigrations } from '../src/database/migrations/run-migrations';
import { createTestApp, TestContext, TestUser } from './utils/test-app';

describe('Migration 001: legacy data → workspace model (e2e)', () => {
  let ctx: TestContext;
  let db: Connection['db'];
  let legacyUser: TestUser;
  let legacyProjectId: Types.ObjectId;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.app.get<Connection>(getConnectionToken()).db;
    legacyUser = await ctx.signUp('legacy');
    const owner = new Types.ObjectId(legacyUser.id);
    // Simulate an account that predates workspaces.
    await db.collection('workspaces').deleteMany({ owner });
    await db.collection('workspacemembers').deleteMany({ user: owner });
    await db
      .collection('users')
      .updateOne({ _id: owner }, { $set: { role: 'MANAGER' } });

    legacyProjectId = (
      await db.collection('projects').insertOne({
        title: 'Old project',
        owner,
        members: [],
        status: 'ACTIVE',
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    ).insertedId;
    await db.collection('tasks').insertMany([
      {
        title: 'Loose task',
        description: 'x',
        status: 'COMPLETED',
        priority: 'CRITICAL',
        createdBy: owner,
        assignedTo: owner,
        project: null,
        labels: ['backend', 'Backend'],
        tags: ['api'],
        isDeleted: false,
        isArchived: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        title: 'Project task',
        description: 'y',
        status: 'REVIEW',
        priority: 'LOW',
        createdBy: owner,
        assignedTo: null,
        project: legacyProjectId,
        labels: [],
        tags: [],
        isDeleted: false,
        isArchived: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
  });
  afterAll(() => ctx.close());

  it('converts legacy data and is idempotent', async () => {
    expect(await runMigrations(db, () => undefined)).toEqual([
      '001-workspace-model',
      '002-multi-assignee-and-usernames',
    ]);
    expect(await runMigrations(db, () => undefined)).toEqual([]);

    const user = await db
      .collection('users')
      .findOne({ _id: new Types.ObjectId(legacyUser.id) });
    expect(user.role).toBe('USER');

    const workspaces = (await ctx.as(legacyUser).get('/workspaces').expect(200))
      .body;
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]).toMatchObject({ type: 'PERSONAL', role: 'OWNER' });

    const projects = (
      await ctx
        .as(legacyUser)
        .get(`/workspaces/${workspaces[0]._id}/projects`)
        .expect(200)
    ).body.items;
    expect(projects.map((p) => p.name).sort()).toEqual([
      'Inbox',
      'Old project',
    ]);

    const inbox = projects.find((p) => p.name === 'Inbox');
    const [loose] = (
      await ctx.as(legacyUser).get(`/projects/${inbox._id}/tasks`).expect(200)
    ).body.items;
    expect(loose).toMatchObject({
      title: 'Loose task',
      status: 'DONE',
      priority: 'URGENT',
    });
    expect(loose.assignees.map((u) => u._id)).toEqual([legacyUser.id]);
    expect(loose.labels.map((l) => l.name).sort()).toEqual(['api', 'backend']);

    const [moved] = (
      await ctx
        .as(legacyUser)
        .get(`/projects/${legacyProjectId}/tasks`)
        .expect(200)
    ).body.items;
    expect(moved).toMatchObject({ title: 'Project task', status: 'IN_REVIEW' });
  });
});

describe('Migration 002: multi-assignee + case-insensitive usernames (e2e)', () => {
  let ctx: TestContext;
  let db: Connection['db'];

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.app.get<Connection>(getConnectionToken()).db;
    // The app module (and so the database) is shared with the suite above:
    // start from "001 applied, 002 pending" either way.
    const ledger = db.collection<{ _id: string; appliedAt: Date }>(
      '_migrations',
    );
    await ledger.updateOne(
      { _id: '001-workspace-model' },
      { $setOnInsert: { appliedAt: new Date() } },
      { upsert: true },
    );
    await ledger.deleteOne({ _id: '002-multi-assignee-and-usernames' });
  });
  afterAll(() => ctx.close());

  it('moves assignee into assignees and lowercases usernames without clashes', async () => {
    const users = db.collection('users');
    const [lower, upper, mixed] = await Promise.all(
      ['lower', 'upper', 'mixed'].map((n) => ctx.signUp(n)),
    );
    // Legacy rows written before usernames were lowercased.
    await users.updateOne(
      { _id: new Types.ObjectId(lower.id) },
      { $set: { userName: 'shiva' } },
    );
    await users.updateOne(
      { _id: new Types.ObjectId(upper.id) },
      { $set: { userName: 'Shiva' } },
    );
    await users.updateOne(
      { _id: new Types.ObjectId(mixed.id) },
      { $set: { userName: 'Ram.Thapa' } },
    );

    const tasks = db.collection('tasks');
    const base = {
      workspace: new Types.ObjectId(),
      project: new Types.ObjectId(),
      createdBy: new Types.ObjectId(lower.id),
      title: 't',
      deletedAt: null,
    };
    const { insertedIds } = await tasks.insertMany([
      { ...base, assignee: new Types.ObjectId(lower.id) },
      { ...base, assignee: null },
    ]);

    expect(await runMigrations(db, () => undefined)).toEqual([
      '002-multi-assignee-and-usernames',
    ]);

    const [assigned, unassigned] = await Promise.all([
      tasks.findOne({ _id: insertedIds[0] }),
      tasks.findOne({ _id: insertedIds[1] }),
    ]);
    expect(assigned.assignees.map(String)).toEqual([lower.id]);
    expect(assigned).not.toHaveProperty('assignee');
    expect(unassigned.assignees).toEqual([]);

    const nameOf = async (id: string) =>
      (await users.findOne({ _id: new Types.ObjectId(id) })).userName;
    expect(await nameOf(lower.id)).toBe('shiva');
    expect(await nameOf(upper.id)).toBe('shiva_2');
    expect(await nameOf(mixed.id)).toBe('ram.thapa');
  });

  it('rejects a username that differs only by case', async () => {
    const taken = await ctx.signUp('casey');
    const res = await ctx
      .http()
      .post('/auth/register')
      .send({
        firstName: 'Other',
        lastName: 'Person',
        email: `other.${Date.now()}@taskify.test`,
        userName: taken.userName.toUpperCase(),
        password: 'Password@123',
      });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Username already exists');
  });
});

describe('Tasks saved before migration 002 (e2e)', () => {
  let ctx: TestContext;
  let db: Connection['db'];

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.app.get<Connection>(getConnectionToken()).db;
    const ledger = db.collection<{ _id: string; appliedAt: Date }>(
      '_migrations',
    );
    await ledger.updateOne(
      { _id: '001-workspace-model' },
      { $setOnInsert: { appliedAt: new Date() } },
      { upsert: true },
    );
    await ledger.deleteOne({ _id: '002-multi-assignee-and-usernames' });
  });
  afterAll(() => ctx.close());

  it('can be read, edited and commented on, and keep their assignee', async () => {
    const user = await ctx.signUp('legacyedit');
    const [personal] = (await ctx.as(user).get('/workspaces').expect(200)).body;
    const project = (
      await ctx
        .as(user)
        .post(`/workspaces/${personal._id}/projects`)
        .send({ name: 'Old' })
        .expect(201)
    ).body._id;
    const taskId = (
      await ctx
        .as(user)
        .post(`/projects/${project}/tasks`)
        .send({ title: 'Before' })
        .expect(201)
    ).body._id;
    // Shape written by the previous release.
    await db.collection('tasks').updateOne(
      { _id: new Types.ObjectId(taskId) },
      {
        $set: { assignee: new Types.ObjectId(user.id) },
        $unset: { assignees: '' },
      },
    );

    const read = await ctx.as(user).get(`/tasks/${taskId}`).expect(200);
    expect(read.body.assignees.map((u) => u._id)).toEqual([user.id]);
    expect(read.body).not.toHaveProperty('assignee');

    // What the app's edit form sends back.
    const saved = await ctx
      .as(user)
      .patch(`/tasks/${taskId}`)
      .send({ title: 'After', assigneeIds: [user.id] })
      .expect(200);
    expect(saved.body.title).toBe('After');
    expect(saved.body.assignees.map((u) => u._id)).toEqual([user.id]);

    await ctx
      .as(user)
      .post(`/tasks/${taskId}/comments`)
      .send({ content: 'still works' })
      .expect(201);

    await runMigrations(db, () => undefined);
    const stored = await db
      .collection('tasks')
      .findOne({ _id: new Types.ObjectId(taskId) });
    expect(stored.assignees.map(String)).toEqual([user.id]);
    expect(stored).not.toHaveProperty('assignee');
  });
});
