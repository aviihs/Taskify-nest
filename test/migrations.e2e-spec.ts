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
    expect(loose.assignee._id).toBe(legacyUser.id);
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
