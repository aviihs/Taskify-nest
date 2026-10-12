import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { runIntegrityChecks } from '../src/database/integrity/integrity-checks';
import { createTestApp, TestContext, TestUser } from './utils/test-app';

/**
 * Cascades run synchronously inside the request's transaction
 * (docs/DATA_MODEL.md §4), so their effects are visible as soon as the
 * response arrives: no waiting for event listeners.
 */
describe('Data integrity: cascades and transactions (e2e)', () => {
  let ctx: TestContext;
  let db: Connection['db'];
  let owner: TestUser;
  let workspace: string;
  let project: string;

  const oid = (id: string) => new Types.ObjectId(id);
  const invite = async (user: TestUser, role: string) =>
    (
      await ctx
        .as(owner)
        .post(`/workspaces/${workspace}/invitations`)
        .send({ email: user.email, role })
        .expect(201)
    ).body._id as string;
  const join = async (user: TestUser, role = 'MEMBER') => {
    const id = await invite(user, role);
    await ctx.as(user).post(`/invitations/${id}/accept`).expect(201);
    await ctx
      .as(owner)
      .post(`/projects/${project}/members`)
      .send({ userId: user.id })
      .expect(201);
  };
  const newTask = async (body: Record<string, unknown>) =>
    (
      await ctx
        .as(owner)
        .post(`/projects/${project}/tasks`)
        .send(body)
        .expect(201)
    ).body._id as string;
  const expectNoIntegrityErrors = async () => {
    const { findings } = await runIntegrityChecks(db);
    expect(findings.filter((f) => f.severity === 'error')).toEqual([]);
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.app.get<Connection>(getConnectionToken()).db;
    owner = await ctx.signUp('owner');
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
  });
  afterAll(() => ctx.close());

  it('creates a workspace with its OWNER membership and a project with its creator row', async () => {
    expect(
      await db
        .collection('workspace_members')
        .findOne({ workspace: oid(workspace), user: oid(owner.id) }),
    ).toMatchObject({ role: 'OWNER', status: 'ACTIVE' });
    expect(
      await db
        .collection('project_members')
        .countDocuments({ project: oid(project), user: oid(owner.id) }),
    ).toBe(1);
  });

  it('removing a member revokes project access and unassigns open work, keeping finished work', async () => {
    const leaver = await ctx.signUp('leaver');
    await join(leaver);
    const open = await newTask({ title: 'Open', assigneeIds: [leaver.id] });
    const done = await newTask({
      title: 'Done',
      status: 'DONE',
      assigneeIds: [leaver.id],
    });

    await ctx
      .as(owner)
      .delete(`/workspaces/${workspace}/members/${leaver.id}`)
      .expect(204);

    expect(
      await db
        .collection('project_members')
        .countDocuments({ workspace: oid(workspace), user: oid(leaver.id) }),
    ).toBe(0);
    const tasks = db.collection('tasks');
    expect((await tasks.findOne({ _id: oid(open) })).assignees).toEqual([]);
    expect(
      (await tasks.findOne({ _id: oid(done) })).assignees.map(String),
    ).toEqual([leaver.id]);
    await ctx.as(leaver).get(`/projects/${project}`).expect(404);
    await expectNoIntegrityErrors();
  });

  it('deleting a label removes it from every task', async () => {
    const label = (
      await ctx
        .as(owner)
        .post(`/workspaces/${workspace}/labels`)
        .send({ name: 'Temp' })
        .expect(201)
    ).body._id;
    const task = await newTask({ title: 'Labelled', labelIds: [label] });

    await ctx.as(owner).delete(`/labels/${label}`).expect(204);

    expect(
      (await db.collection('tasks').findOne({ _id: oid(task) })).labels,
    ).toEqual([]);
    await expectNoIntegrityErrors();
  });

  it('deleting a task soft-deletes its subtasks and drops every dependency edge touching them', async () => {
    const parent = await newTask({ title: 'Parent' });
    const child = await newTask({ title: 'Child', parentTaskId: parent });
    const other = await newTask({ title: 'Other' });
    const waiting = await newTask({ title: 'Waiting' });
    await ctx
      .as(owner)
      .post(`/tasks/${other}/dependencies`)
      .send({ blockedByTaskId: child })
      .expect(201);
    await ctx
      .as(owner)
      .post(`/tasks/${parent}/dependencies`)
      .send({ blockedByTaskId: waiting })
      .expect(201);

    await ctx.as(owner).delete(`/tasks/${parent}`).expect(204);

    const tasks = db.collection('tasks');
    expect((await tasks.findOne({ _id: oid(child) })).deletedAt).toBeTruthy();
    expect(
      await db.collection('task_dependencies').countDocuments({
        $or: [
          { blockingTask: { $in: [oid(parent), oid(child)] } },
          { blockedTask: { $in: [oid(parent), oid(child)] } },
        ],
      }),
    ).toBe(0);
    await expectNoIntegrityErrors();
  });

  describe('invitations', () => {
    it('keeps the invitation pending when the membership cannot be created', async () => {
      const racer = await ctx.signUp('racer');
      const id = await invite(racer, 'MEMBER');
      // The user became a member some other way in the meantime.
      await db.collection('workspace_members').insertOne({
        workspace: oid(workspace),
        user: oid(racer.id),
        role: 'VIEWER',
        status: 'ACTIVE',
      });

      await ctx.as(racer).post(`/invitations/${id}/accept`).expect(409);

      expect(
        await db.collection('workspace_invitations').findOne({ _id: oid(id) }),
      ).toMatchObject({ status: 'PENDING', respondedAt: null });
    });

    it('rejects inviting a suspended member', async () => {
      const suspended = await ctx.signUp('suspended');
      await join(suspended);
      await ctx
        .as(owner)
        .patch(`/workspaces/${workspace}/members/${suspended.id}`)
        .send({ status: 'SUSPENDED' })
        .expect(200);

      const res = await ctx
        .as(owner)
        .post(`/workspaces/${workspace}/invitations`)
        .send({ email: suspended.email, role: 'MEMBER' })
        .expect(409);
      expect(res.body.message).toMatch(/suspended/);
    });

    it('does not let an admin cancel an invitation for an equal role', async () => {
      const admin = await ctx.signUp('admin');
      await join(admin, 'ADMIN');
      const target = await ctx.signUp('target');
      const id = await invite(target, 'ADMIN');

      await ctx
        .as(admin)
        .delete(`/workspaces/${workspace}/invitations/${id}`)
        .expect(403);
      await ctx
        .as(owner)
        .delete(`/workspaces/${workspace}/invitations/${id}`)
        .expect(204);
    });
  });
});
