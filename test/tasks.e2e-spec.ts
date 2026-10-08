import { createTestApp, TestContext, TestUser } from './utils/test-app';

describe('Projects, tasks, subtasks, labels, dependencies & search (e2e)', () => {
  let ctx: TestContext;
  let owner: TestUser; // OWNER of Acme
  let member: TestUser; // MEMBER of Acme
  let manager: TestUser; // MANAGER of Acme
  let outsider: TestUser; // not in Acme
  let acme: string;
  let project: string;

  const join = async (user: TestUser, role: string) => {
    const inv = await ctx
      .as(owner)
      .post(`/workspaces/${acme}/invitations`)
      .send({ email: user.email, role })
      .expect(201);
    await ctx.as(user).post(`/invitations/${inv.body._id}/accept`).expect(201);
  };
  const createTask = (
    user: TestUser,
    body: Record<string, unknown>,
    projectId = project,
  ) => ctx.as(user).post(`/projects/${projectId}/tasks`).send(body);

  beforeAll(async () => {
    ctx = await createTestApp();
    [owner, member, manager, outsider] = await Promise.all(
      ['owner', 'member', 'manager', 'outsider'].map((n) => ctx.signUp(n)),
    );
    acme = (
      await ctx.as(owner).post('/workspaces').send({ name: 'Acme' }).expect(201)
    ).body._id;
    await join(member, 'MEMBER');
    await join(manager, 'MANAGER');
    project = (
      await ctx
        .as(owner)
        .post(`/workspaces/${acme}/projects`)
        .send({ name: 'Launch' })
        .expect(201)
    ).body._id;
  });
  afterAll(() => ctx.close());

  describe('projects', () => {
    it('belong to the workspace they were created in', async () => {
      const res = await ctx.as(owner).get(`/projects/${project}`).expect(200);
      expect(res.body.workspace).toBe(acme);
      expect(res.body.progress).toEqual({ total: 0, completed: 0, percent: 0 });
    });

    it('are visible to members only once added; managers see all', async () => {
      await ctx.as(member).get(`/projects/${project}`).expect(404);
      const asMember = await ctx
        .as(member)
        .get(`/workspaces/${acme}/projects`)
        .expect(200);
      expect(asMember.body.items).toHaveLength(0);
      const asManager = await ctx
        .as(manager)
        .get(`/workspaces/${acme}/projects`)
        .expect(200);
      expect(asManager.body.items).toHaveLength(1);

      await ctx
        .as(owner)
        .post(`/projects/${project}/members`)
        .send({ userId: member.id })
        .expect(201);
      await ctx
        .as(owner)
        .post(`/projects/${project}/members`)
        .send({ userId: member.id })
        .expect(409);
      await ctx.as(member).get(`/projects/${project}`).expect(200);
    });

    it('cannot be modified without permission', async () => {
      await ctx
        .as(member)
        .patch(`/projects/${project}`)
        .send({ name: 'Nope' })
        .expect(403);
      await ctx.as(member).delete(`/projects/${project}`).expect(403);
      await ctx
        .as(member)
        .post(`/workspaces/${acme}/projects`)
        .send({ name: 'X' })
        .expect(403);
      await ctx.as(outsider).get(`/projects/${project}`).expect(404);
      await ctx
        .as(owner)
        .post(`/projects/${project}/members`)
        .send({ userId: outsider.id })
        .expect(400); // not a workspace member
    });

    it('rejects a due date before the start date', async () => {
      await ctx
        .as(owner)
        .post(`/workspaces/${acme}/projects`)
        .send({
          name: 'Bad dates',
          startDate: '2026-12-01',
          dueDate: '2026-11-01',
        })
        .expect(400);
    });
  });

  describe('tasks', () => {
    let taskId: string;

    it('inherit project and workspace from the server, not the client', async () => {
      const res = await createTask(member, {
        title: 'Implement login',
        priority: 'HIGH',
      }).expect(201);
      taskId = res.body._id;
      expect(res.body).toMatchObject({
        project,
        workspace: acme,
        status: 'TODO',
        priority: 'HIGH',
        parentTask: null,
      });
      // Client-supplied scope fields are rejected outright.
      await createTask(member, { title: 'x', workspace: outsider.id }).expect(
        400,
      );
    });

    it('are invisible outside the workspace', async () => {
      await ctx.as(outsider).get(`/tasks/${taskId}`).expect(404);
      await ctx
        .as(outsider)
        .patch(`/tasks/${taskId}`)
        .send({ status: 'DONE' })
        .expect(404);
      await ctx.as(outsider).delete(`/tasks/${taskId}`).expect(404);
      await ctx.as(outsider).get(`/tasks/${taskId}/comments`).expect(404);
    });

    it('only accept assignees who can see the project', async () => {
      await ctx
        .as(owner)
        .patch(`/tasks/${taskId}`)
        .send({ assigneeId: outsider.id })
        .expect(400);
      const res = await ctx
        .as(owner)
        .patch(`/tasks/${taskId}`)
        .send({ assigneeId: member.id })
        .expect(200);
      expect(res.body.assignee).toMatchObject({ _id: member.id });
      expect(res.body.assignee).not.toHaveProperty('password');
    });

    it('enforce role permissions (members cannot delete)', async () => {
      await ctx.as(member).delete(`/tasks/${taskId}`).expect(403);
    });

    it('track completion time and record status history', async () => {
      const done = await ctx
        .as(member)
        .patch(`/tasks/${taskId}`)
        .send({ status: 'DONE' })
        .expect(200);
      expect(done.body.completedAt).toBeTruthy();
      const reopened = await ctx
        .as(member)
        .patch(`/tasks/${taskId}`)
        .send({ status: 'IN_PROGRESS' })
        .expect(200);
      expect(reopened.body.completedAt).toBeNull();

      await new Promise((r) => setTimeout(r, 50)); // listeners are async
      const history = await ctx
        .as(member)
        .get(`/tasks/${taskId}/activity`)
        .expect(200);
      const statusChanges = history.body.items
        .filter((a) => a.metadata?.changes?.status)
        .map((a) => a.metadata.changes.status);
      expect(statusChanges).toEqual(
        expect.arrayContaining([
          { from: 'TODO', to: 'DONE' },
          { from: 'DONE', to: 'IN_PROGRESS' },
        ]),
      );
    });

    it('filter, paginate and validate list queries', async () => {
      await createTask(owner, { title: 'Write docs', priority: 'LOW' }).expect(
        201,
      );
      const high = await ctx
        .as(owner)
        .get(`/projects/${project}/tasks?priority=HIGH`)
        .expect(200);
      expect(high.body.items.map((t) => t.title)).toEqual(['Implement login']);
      const paged = await ctx
        .as(owner)
        .get(`/projects/${project}/tasks?limit=1&page=2`)
        .expect(200);
      expect(paged.body.meta).toMatchObject({
        page: 2,
        limit: 1,
        total: 2,
        totalPages: 2,
      });
      await ctx
        .as(owner)
        .get(`/projects/${project}/tasks?status=WHATEVER`)
        .expect(400);
      await ctx
        .as(owner)
        .get(`/projects/${project}/tasks?limit=1000`)
        .expect(400);
    });
  });

  describe('subtasks', () => {
    it('compute parent progress from children and nest only one level', async () => {
      const parent = (
        await createTask(owner, { title: 'Build auth' }).expect(201)
      ).body._id;
      const a = (
        await createTask(owner, { title: 'UI', parentTaskId: parent }).expect(
          201,
        )
      ).body._id;
      await createTask(owner, { title: 'API', parentTaskId: parent }).expect(
        201,
      );
      await ctx
        .as(owner)
        .patch(`/tasks/${a}`)
        .send({ status: 'DONE' })
        .expect(200);

      const res = await ctx.as(owner).get(`/tasks/${parent}`).expect(200);
      expect(res.body.subtaskProgress).toEqual({
        total: 2,
        completed: 1,
        percent: 50,
      });
      await createTask(owner, { title: 'Too deep', parentTaskId: a }).expect(
        400,
      );

      const subtasks = await ctx
        .as(owner)
        .get(`/tasks/${parent}/subtasks`)
        .expect(200);
      expect(subtasks.body).toHaveLength(2);
      // Top-level listing excludes subtasks by default.
      const list = await ctx
        .as(owner)
        .get(`/projects/${project}/tasks?search=API`)
        .expect(200);
      expect(list.body.items).toHaveLength(0);

      await ctx.as(owner).delete(`/tasks/${parent}`).expect(204);
      await ctx.as(owner).get(`/tasks/${a}`).expect(404); // cascades to subtasks
    });

    it('cannot use a parent from another project', async () => {
      const other = (
        await ctx
          .as(owner)
          .post(`/workspaces/${acme}/projects`)
          .send({ name: 'Other' })
          .expect(201)
      ).body._id;
      const foreign = (
        await createTask(owner, { title: 'Foreign' }, other).expect(201)
      ).body._id;
      await createTask(owner, { title: 'Child', parentTaskId: foreign }).expect(
        400,
      );
    });
  });

  describe('labels', () => {
    it('are unique per workspace (case-insensitive) and cannot cross workspaces', async () => {
      const label = await ctx
        .as(owner)
        .post(`/workspaces/${acme}/labels`)
        .send({ name: 'Backend' })
        .expect(201);
      await ctx
        .as(owner)
        .post(`/workspaces/${acme}/labels`)
        .send({ name: 'backend' })
        .expect(409);
      await ctx
        .as(member)
        .post(`/workspaces/${acme}/labels`)
        .send({ name: 'Mine' })
        .expect(403);

      const personal = (await ctx.as(outsider).get('/workspaces').expect(200))
        .body[0]._id;
      const foreign = await ctx
        .as(outsider)
        .post(`/workspaces/${personal}/labels`)
        .send({ name: 'Bug' })
        .expect(201);

      const task = await createTask(owner, {
        title: 'Labelled',
        labelIds: [label.body._id],
      }).expect(201);
      expect(task.body.labels).toEqual([
        expect.objectContaining({ name: 'Backend' }),
      ]);
      await createTask(owner, {
        title: 'Bad label',
        labelIds: [foreign.body._id],
      }).expect(400);

      await ctx.as(owner).delete(`/labels/${label.body._id}`).expect(204);
      await new Promise((r) => setTimeout(r, 50));
      const after = await ctx
        .as(owner)
        .get(`/tasks/${task.body._id}`)
        .expect(200);
      expect(after.body.labels).toEqual([]);
    });
  });

  describe('dependencies', () => {
    it('reject self, duplicate and circular dependencies', async () => {
      const [design, dev, test] = await Promise.all(
        ['Design', 'Development', 'Testing'].map(
          async (title) =>
            (
              await createTask(owner, { title }).expect(201)
            ).body._id,
        ),
      );
      const deps = (id: string) =>
        ctx.as(owner).post(`/tasks/${id}/dependencies`);

      await deps(dev).send({ blockedByTaskId: dev }).expect(400);
      await deps(dev).send({ blockedByTaskId: design }).expect(201);
      await deps(dev).send({ blockedByTaskId: design }).expect(409);
      await deps(test).send({ blockedByTaskId: dev }).expect(201);
      await deps(design).send({ blockedByTaskId: test }).expect(400); // design → dev → test → design

      const view = await ctx
        .as(owner)
        .get(`/tasks/${test}/dependencies`)
        .expect(200);
      expect(view.body.isBlocked).toBe(true);
      expect(view.body.blockedBy.map((d) => d.task.title)).toEqual([
        'Development',
      ]);
    });
  });

  describe('my tasks', () => {
    it('lists tasks assigned to me across workspaces with due-date views', async () => {
      const personal = (
        await ctx.as(member).get('/workspaces').expect(200)
      ).body.find((w) => w.type === 'PERSONAL')._id;
      const mine = (
        await ctx
          .as(member)
          .post(`/workspaces/${personal}/projects`)
          .send({ name: 'Home' })
          .expect(201)
      ).body._id;
      const yesterday = new Date(Date.now() - 86_400_000).toISOString();
      await createTask(
        member,
        { title: 'Overdue chore', assigneeId: member.id, dueDate: yesterday },
        mine,
      ).expect(201);

      const all = await ctx.as(member).get('/users/me/tasks').expect(200);
      const titles = all.body.items.map((t) => t.title);
      expect(titles).toEqual(
        expect.arrayContaining(['Overdue chore', 'Implement login']),
      );
      expect(all.body.items.every((t) => t.assignee._id === member.id)).toBe(
        true,
      );

      const overdue = await ctx
        .as(member)
        .get('/users/me/tasks?view=overdue')
        .expect(200);
      expect(overdue.body.items.map((t) => t.title)).toEqual(['Overdue chore']);

      const onlyAcme = await ctx
        .as(member)
        .get(`/users/me/tasks?workspaceId=${acme}`)
        .expect(200);
      expect(onlyAcme.body.items.every((t) => t.workspace._id === acme)).toBe(
        true,
      );
    });
  });

  describe('search', () => {
    it('never returns data from workspaces the user is not in', async () => {
      const personal = (await ctx.as(outsider).get('/workspaces').expect(200))
        .body[0]._id;
      const secret = (
        await ctx
          .as(outsider)
          .post(`/workspaces/${personal}/projects`)
          .send({ name: 'Zebra secret' })
          .expect(201)
      ).body._id;
      await createTask(outsider, { title: 'Zebra plan' }, secret).expect(201);
      await createTask(owner, { title: 'Zebra launch' }).expect(201);

      const asOwner = await ctx.as(owner).get('/search?q=zebra').expect(200);
      expect(asOwner.body.tasks.map((t) => t.title)).toEqual(['Zebra launch']);
      expect(asOwner.body.projects).toHaveLength(0);

      const asOutsider = await ctx
        .as(outsider)
        .get('/search?q=zebra')
        .expect(200);
      expect(asOutsider.body.tasks.map((t) => t.title)).toEqual(['Zebra plan']);

      // People search is limited to co-members; regex input is treated literally.
      const people = await ctx
        .as(outsider)
        .get(`/search?q=${owner.userName}&types=users`)
        .expect(200);
      expect(people.body.users).toHaveLength(0);
      await ctx.as(owner).get('/search?q=.*(&types=tasks').expect(200);
      const forged = await ctx
        .as(owner)
        .get(`/search?q=zebra&workspaceId=${personal}`)
        .expect(200);
      expect(forged.body.tasks).toHaveLength(0);
    });
  });
});
