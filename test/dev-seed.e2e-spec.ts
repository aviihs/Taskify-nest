import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { resetRefusals } from '../src/database/dev-reset';
import { runIntegrityChecks } from '../src/database/integrity/integrity-checks';
import { resetAndSeed, SEED_PASSWORD } from '../src/database/seed/dev-seed';
import { createTestApp, TestContext } from './utils/test-app';

describe('Development reset and seed (e2e)', () => {
  let ctx: TestContext;
  let connection: Connection;

  beforeAll(async () => {
    ctx = await createTestApp();
    connection = ctx.app.get<Connection>(getConnectionToken());
  });
  afterAll(() => ctx.close());

  it('replaces all data with a seed that passes every integrity check', async () => {
    await ctx.signUp('wiped'); // existing data that the reset removes
    await connection.db.collection('teams').insertOne({ legacy: true });

    const { collections } = await resetAndSeed(connection);

    expect(collections).toMatchObject({
      users: 5,
      workspaces: 6,
      workspace_members: 10,
      projects: 3,
      tasks: 7,
      labels: 3,
      task_dependencies: 1,
      comments: 2,
    });
    const names = (await connection.db.listCollections().toArray()).map(
      (c) => c.name,
    );
    expect(names).not.toContain('teams');
    expect(
      await connection.db.collection('users').countDocuments({
        email: { $regex: 'wiped' },
      }),
    ).toBe(0);

    const report = await runIntegrityChecks(connection.db);
    expect(report.findings).toEqual([]);
    expect(report.unmanagedCollections).toEqual([]);
  });

  it('produces data the API serves with the documented permissions', async () => {
    await resetAndSeed(connection);
    const login = async (email: string) =>
      (
        await ctx
          .http()
          .post('/auth/login')
          .send({ email, password: SEED_PASSWORD })
          .expect(201)
      ).body.accessToken as string;
    const get = (token: string, url: string) =>
      ctx.http().get(url).set('Authorization', `Bearer ${token}`);

    const dave = await login('dave@taskify.dev');
    const workspaces = (await get(dave, '/workspaces').expect(200)).body;
    const acme = workspaces.find((w) => w.name === 'Acme Inc');
    expect(acme).toMatchObject({ role: 'MEMBER', memberCount: 5 });
    const projects = (
      await get(dave, `/workspaces/${acme._id}/projects`).expect(200)
    ).body.items.map((p) => p.name);
    expect(projects.sort()).toEqual(['Mobile App', 'Website Relaunch']);

    // VIEWER sees only the project they belong to.
    const erin = await login('erin@taskify.dev');
    const visible = (
      await get(erin, `/workspaces/${acme._id}/projects`).expect(200)
    ).body.items.map((p) => p.name);
    expect(visible).toEqual(['Website Relaunch']);
  });

  describe('guard', () => {
    const base = {
      nodeEnv: 'development',
      allowReset: 'true',
      confirm: 'cluster.example.net/Taskify',
      backupDir: '/backups/today',
      target: { host: 'cluster.example.net', database: 'Taskify' },
      nonEmptyCollections: ['users', 'tasks'],
      fileExists: () => true,
    };

    it('allows a confirmed, backed-up development reset', () => {
      expect(resetRefusals(base)).toEqual([]);
    });

    it('refuses production, a missing opt-in, the wrong target or a missing backup', () => {
      expect(resetRefusals({ ...base, nodeEnv: 'production' })).toContain(
        'NODE_ENV is production',
      );
      expect(resetRefusals({ ...base, allowReset: undefined })).toContain(
        'ALLOW_DB_RESET=true is not set',
      );
      expect(
        resetRefusals({ ...base, confirm: 'other.example.net/Taskify' }),
      ).toContain('--confirm must be exactly "cluster.example.net/Taskify"');
      expect(resetRefusals({ ...base, backupDir: undefined })).toHaveLength(1);
      expect(
        resetRefusals({
          ...base,
          fileExists: (p) => !p.endsWith('tasks.bson') && !p.endsWith('.gz'),
        }),
      ).toEqual(['backup in /backups/today has no dump of: tasks']);
    });

    it('needs no backup for an empty database', () => {
      expect(
        resetRefusals({
          ...base,
          backupDir: undefined,
          nonEmptyCollections: [],
        }),
      ).toEqual([]);
    });
  });
});
