import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import {
  IntegrityReport,
  runIntegrityChecks,
} from '../src/database/integrity/integrity-checks';
import { createTestApp, TestContext, TestUser } from './utils/test-app';

describe('db:check integrity report (e2e)', () => {
  let ctx: TestContext;
  let db: Connection['db'];
  let user: TestUser;
  let workspaceId: string;
  let projectId: string;
  let taskId: string;

  const idsFor = (report: IntegrityReport, check: string) =>
    report.findings.find((f) => f.check === check)?.ids ?? [];
  const counts = async () =>
    Object.fromEntries(
      await Promise.all(
        (
          await db.listCollections({}, { nameOnly: true }).toArray()
        ).map(async (c) => [
          c.name,
          await db.collection(c.name).countDocuments(),
        ]),
      ),
    );

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.app.get<Connection>(getConnectionToken()).db;
    user = await ctx.signUp('integrity');
    const client = ctx.as(user);
    workspaceId = (await client.get('/workspaces').expect(200)).body[0]._id;
    projectId = (
      await client
        .post(`/workspaces/${workspaceId}/projects`)
        .send({ name: 'Healthy' })
        .expect(201)
    ).body._id;
    const label = (
      await client
        .post(`/workspaces/${workspaceId}/labels`)
        .send({ name: 'Bug' })
        .expect(201)
    ).body._id;
    taskId = (
      await client
        .post(`/projects/${projectId}/tasks`)
        .send({ title: 'Task', assigneeIds: [user.id], labelIds: [label] })
        .expect(201)
    ).body._id;
    await client
      .post(`/tasks/${taskId}/comments`)
      .send({ content: 'hello' })
      .expect(201);
  });
  afterAll(() => ctx.close());

  it('reports no errors for data written through the API', async () => {
    const report = await runIntegrityChecks(db);
    expect(report.findings.filter((f) => f.severity === 'error')).toEqual([]);
  });

  it('finds orphans, scope mismatches and duplicates without writing anything', async () => {
    const goneWorkspace = new Types.ObjectId();
    const goneTask = new Types.ObjectId();
    const owner = new Types.ObjectId(user.id);
    const now = new Date();

    const orphanProject = (
      await db.collection('projects').insertOne({
        workspace: goneWorkspace,
        name: 'Orphan',
        createdBy: owner,
        deletedAt: null,
      })
    ).insertedId;
    const orphanLabel = (
      await db.collection('labels').insertOne({
        workspace: goneWorkspace,
        name: 'Lost',
        color: '#64748b',
        createdBy: owner,
      })
    ).insertedId;
    const orphanComment = (
      await db.collection('comments').insertOne({
        task: goneTask,
        workspace: new Types.ObjectId(workspaceId),
        project: new Types.ObjectId(projectId),
        author: owner,
        content: 'on a deleted task',
        parentComment: null,
      })
    ).insertedId;
    const mismatchedTask = (
      await db.collection('tasks').insertOne({
        workspace: goneWorkspace,
        project: new Types.ObjectId(projectId),
        parentTask: null,
        title: 'Wrong scope',
        assignees: [],
        labels: [],
        createdBy: owner,
        deletedAt: null,
      })
    ).insertedId;
    const danglingNotification = (
      await db.collection('notifications').insertOne({
        recipient: owner,
        type: 'TASK_ASSIGNED',
        message: 'x',
        entityType: 'task',
        entityId: goneTask,
        workspace: null,
        readAt: null,
        createdAt: now,
      })
    ).insertedId;
    // Bypass the unique index the way a raw import would.
    await db.collection('labels').dropIndex('workspace_1_name_1');
    const duplicateLabel = (
      await db.collection('labels').insertOne({
        workspace: new Types.ObjectId(workspaceId),
        name: 'BUG',
        color: '#64748b',
        createdBy: owner,
      })
    ).insertedId;
    const historicalLog = (
      await db.collection('activity_logs').insertOne({
        workspace: goneWorkspace,
        project: null,
        task: null,
        actor: owner,
        action: 'project.created',
        entityType: 'project',
        entityId: orphanProject,
        metadata: {},
        createdAt: now,
      })
    ).insertedId;
    await db.collection('teams').insertOne({ name: 'unmanaged' });

    const before = await counts();
    const report = await runIntegrityChecks(db);
    expect(await counts()).toEqual(before);

    expect(idsFor(report, 'projects.workspace->workspaces')).toEqual([
      String(orphanProject),
    ]);
    expect(idsFor(report, 'labels.workspace->workspaces')).toEqual([
      String(orphanLabel),
    ]);
    expect(idsFor(report, 'comments.task->tasks')).toEqual([
      String(orphanComment),
    ]);
    expect(idsFor(report, 'tasks.scope-vs-project')).toEqual([
      String(mismatchedTask),
    ]);
    expect(idsFor(report, 'notifications.entityId(task)->tasks')).toEqual([
      String(danglingNotification),
    ]);
    expect(idsFor(report, 'labels.duplicate(w,n)')).toContain(
      String(duplicateLabel),
    );

    const history = report.findings.find(
      (f) => f.check === 'activity_logs.workspace->workspaces',
    );
    expect(history.severity).toBe('info');
    expect(history.ids).toEqual([String(historicalLog)]);
    expect(report.unmanagedCollections).toEqual(['teams']);
    expect(report.collections.teams).toBe(1);
  });
});
