import { TaskPlanner } from '../src/ai/task-planner';
import { createTestApp, TestContext, TestUser } from './utils/test-app';

describe('AI task breakdown (e2e)', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let viewer: TestUser;
  let outsider: TestUser;
  let project: string;
  const planner = {
    breakDown: jest.fn().mockResolvedValue([
      {
        title: 'Authentication',
        description: 'Sign up and login',
        priority: 'HIGH',
        subtasks: [{ title: 'Login API' }, { title: 'Signup UI' }],
      },
      {
        title: 'Cart',
        description: 'Shopping cart',
        priority: 'MEDIUM',
        subtasks: [],
      },
    ]),
  };

  beforeAll(async () => {
    ctx = await createTestApp({ overrides: [[TaskPlanner, planner]] });
    [owner, viewer, outsider] = await Promise.all(
      ['owner', 'viewer', 'outsider'].map((n) => ctx.signUp(n)),
    );
    const ws = (
      await ctx.as(owner).post('/workspaces').send({ name: 'Shop' }).expect(201)
    ).body._id;
    project = (
      await ctx
        .as(owner)
        .post(`/workspaces/${ws}/projects`)
        .send({ name: 'Store' })
        .expect(201)
    ).body._id;
    const inv = await ctx
      .as(owner)
      .post(`/workspaces/${ws}/invitations`)
      .send({ email: viewer.email, role: 'VIEWER' })
      .expect(201);
    await ctx
      .as(viewer)
      .post(`/invitations/${inv.body._id}/accept`)
      .expect(201);
    await ctx
      .as(owner)
      .post(`/projects/${project}/members`)
      .send({ userId: viewer.id })
      .expect(201);
  });
  afterAll(() => ctx.close());

  it('suggests without saving, and only for users who can create tasks', async () => {
    const goal = 'Build an ecommerce application';
    const res = await ctx
      .as(owner)
      .post(`/projects/${project}/ai/task-breakdown`)
      .send({ goal })
      .expect(201);
    expect(res.body.tasks).toHaveLength(2);
    expect(planner.breakDown).toHaveBeenCalledWith(
      expect.objectContaining({ goal, projectName: 'Store' }),
    );
    expect(
      (await ctx.as(owner).get(`/projects/${project}/tasks`).expect(200)).body
        .items,
    ).toHaveLength(0);

    await ctx
      .as(viewer)
      .post(`/projects/${project}/ai/task-breakdown`)
      .send({ goal })
      .expect(403);
    await ctx
      .as(outsider)
      .post(`/projects/${project}/ai/task-breakdown`)
      .send({ goal })
      .expect(404);
  });

  it('applies suggestions through the normal task rules', async () => {
    const { body: tasks } = await ctx
      .as(owner)
      .post(`/projects/${project}/ai/task-breakdown`)
      .send({ goal: 'Build a shop' });
    const created = await ctx
      .as(owner)
      .post(`/projects/${project}/ai/task-breakdown/apply`)
      .send(tasks)
      .expect(201);
    expect(created.body.map((t) => t.title)).toEqual([
      'Authentication',
      'Cart',
    ]);

    const auth = await ctx
      .as(owner)
      .get(`/tasks/${created.body[0]._id}`)
      .expect(200);
    expect(auth.body.subtaskProgress.total).toBe(2);
    await ctx
      .as(viewer)
      .post(`/projects/${project}/ai/task-breakdown/apply`)
      .send(tasks)
      .expect(403);
  });
});
