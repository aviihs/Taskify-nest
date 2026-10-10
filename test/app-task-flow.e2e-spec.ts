import { createTestApp, TestContext, TestUser } from './utils/test-app';

/**
 * The exact requests the mobile app sends when a normal user creates work,
 * in order: find personal workspace → create project → create task →
 * subtask → complete → see it in My Tasks and on the dashboard.
 */
describe('Normal user task flow, as the app sends it (e2e)', () => {
  let ctx: TestContext;
  let user: TestUser;

  beforeAll(async () => {
    ctx = await createTestApp();
    user = await ctx.signUp('normal');
  });

  afterAll(() => ctx.close());

  it('creates a project and tasks in the personal workspace', async () => {
    const api = () => ctx.as(user);

    const workspaces = (await api().get('/workspaces').expect(200)).body;
    const personal = workspaces.find(
      (w: { type: string }) => w.type === 'PERSONAL',
    );
    expect(personal.role).toBe('OWNER');
    expect(personal.permissions).toEqual(
      expect.arrayContaining(['project:create', 'task:create']),
    );

    // ProjectFormSheet → ProjectRepositoryImpl._toJson
    const project = (
      await api()
        .post(`/workspaces/${personal._id}/projects`)
        .send({
          name: 'Exam prep',
          description: '',
          dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        })
        .expect(201)
    ).body;

    // TaskFormSheet → TaskModel.inputToJson (no assignee, no labels picked)
    const dueToday = new Date();
    dueToday.setHours(23, 59, 0, 0);
    const task = (
      await api()
        .post(`/projects/${project._id}/tasks`)
        .send({
          title: 'Revise chapter 1',
          description: '',
          status: 'TODO',
          priority: 'HIGH',
          labelIds: [],
          dueDate: dueToday.toISOString(),
        })
        .expect(201)
    ).body;
    expect(task.workspace).toBe(personal._id);

    // Subtask from the task page
    await api()
      .post(`/projects/${project._id}/tasks`)
      .send({
        title: 'Read notes',
        description: '',
        status: 'TODO',
        priority: 'MEDIUM',
        labelIds: [],
        parentTaskId: task._id,
      })
      .expect(201);

    // Personal workspace: the owner can assign to themselves.
    await api()
      .patch(`/tasks/${task._id}`)
      .send({ assigneeIds: [user.id] })
      .expect(200);

    const mine =
      // Same offset the app sends (JS getTimezoneOffset), so "today" is local.
      (
        await api()
          .get(
            `/users/me/tasks?view=today&tzOffset=${new Date().getTimezoneOffset()}`,
          )
          .expect(200)
      ).body;
    expect(mine.items.map((t: { _id: string }) => t._id)).toContain(task._id);

    // Clearing the due date sends an explicit null.
    await api()
      .patch(`/tasks/${task._id}`)
      .send({ dueDate: null, status: 'DONE' })
      .expect(200);

    const dashboard = (
      await api().get(`/workspaces/${personal._id}/dashboard`).expect(200)
    ).body;
    expect(dashboard.summary.total).toBe(1);
    expect(dashboard.summary.completed).toBe(1);
  });
});
