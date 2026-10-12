import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { createTestApp, TestContext, TestUser } from './utils/test-app';

const settle = () => new Promise((r) => setTimeout(r, 100)); // async event listeners

/** Notifications, activity and task reads follow *current* access. */
describe('Access-aware side effects (e2e)', () => {
  let ctx: TestContext;
  let db: Connection['db'];
  let owner: TestUser;
  let viewer: TestUser;
  let workspace: string;
  let project: string;

  const join = async (user: TestUser, role: string) => {
    const inv = await ctx
      .as(owner)
      .post(`/workspaces/${workspace}/invitations`)
      .send({ email: user.email, role })
      .expect(201);
    await ctx.as(user).post(`/invitations/${inv.body._id}/accept`).expect(201);
    await ctx
      .as(owner)
      .post(`/projects/${project}/members`)
      .send({ userId: user.id })
      .expect(201);
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.app.get<Connection>(getConnectionToken()).db;
    [owner, viewer] = await Promise.all([
      ctx.signUp('owner'),
      ctx.signUp('viewer'),
    ]);
    workspace = (
      await ctx.as(owner).post('/workspaces').send({ name: 'Acme' }).expect(201)
    ).body._id;
    project = (
      await ctx
        .as(owner)
        .post(`/workspaces/${workspace}/projects`)
        .send({ name: 'Launch' })
        .expect(201)
    ).body._id;
    await join(viewer, 'VIEWER');
  });
  afterAll(() => ctx.close());

  it('does not notify a task creator who has left the workspace', async () => {
    const creator = await ctx.signUp('creator');
    await join(creator, 'MEMBER');
    const task = (
      await ctx
        .as(creator)
        .post(`/projects/${project}/tasks`)
        .send({ title: 'Secret plan' })
        .expect(201)
    ).body._id;
    await ctx
      .as(creator)
      .delete(`/workspaces/${workspace}/members/${creator.id}`)
      .expect(204);

    await ctx
      .as(owner)
      .post(`/tasks/${task}/comments`)
      .send({ content: 'still on?' })
      .expect(201);
    await ctx
      .as(owner)
      .patch(`/tasks/${task}`)
      .send({ status: 'DONE' })
      .expect(200);
    await settle();

    const inbox = (await ctx.as(creator).get('/notifications').expect(200)).body
      .items;
    expect(inbox.filter((n) => n.entityId === task)).toEqual([]);
  });

  it('rejects assignees without access in one batched check', async () => {
    const outsider = await ctx.signUp('outsider');
    const res = await ctx
      .as(owner)
      .post(`/projects/${project}/tasks`)
      .send({ title: 'x', assigneeIds: [viewer.id, outsider.id] })
      .expect(400);
    expect(res.body.message).toMatch(/Assignees must be workspace members/);
  });

  it('never shows invitee emails in the activity feed, including old rows', async () => {
    const invitee = await ctx.signUp('invitee');
    await ctx
      .as(owner)
      .post(`/workspaces/${workspace}/invitations`)
      .send({ email: invitee.email, role: 'MEMBER' })
      .expect(201);
    // A row written before emails were stripped at write time.
    await db.collection('activity_logs').insertOne({
      workspace: new Types.ObjectId(workspace),
      project: null,
      task: null,
      actor: new Types.ObjectId(owner.id),
      action: 'invitation.created',
      entityType: 'invitation',
      entityId: new Types.ObjectId(),
      metadata: { email: 'legacy@taskify.test', role: 'MEMBER' },
      createdAt: new Date(),
    });
    await settle();

    const feed = (
      await ctx
        .as(viewer)
        .get(`/workspaces/${workspace}/activity?limit=100`)
        .expect(200)
    ).body.items.filter((a) => a.action === 'invitation.created');
    expect(feed.length).toBeGreaterThanOrEqual(2);
    for (const entry of feed)
      expect(entry.metadata).not.toHaveProperty('email');
    expect(feed.some((e) => e.metadata.role === 'MEMBER')).toBe(true);
  });

  it('hides a task whose copied workspace does not match its project', async () => {
    const task = (
      await ctx
        .as(owner)
        .post(`/projects/${project}/tasks`)
        .send({ title: 'Tampered' })
        .expect(201)
    ).body._id;
    await ctx.as(owner).get(`/tasks/${task}`).expect(200);
    await db
      .collection('tasks')
      .updateOne(
        { _id: new Types.ObjectId(task) },
        { $set: { workspace: new Types.ObjectId() } },
      );
    await ctx.as(owner).get(`/tasks/${task}`).expect(404);
  });

  it('can clear a project date', async () => {
    await ctx
      .as(owner)
      .patch(`/projects/${project}`)
      .send({ dueDate: '2030-01-01' })
      .expect(200);
    const cleared = await ctx
      .as(owner)
      .patch(`/projects/${project}`)
      .send({ dueDate: null })
      .expect(200);
    expect(cleared.body.dueDate).toBeNull();
  });
});
