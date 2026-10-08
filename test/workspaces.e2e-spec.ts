import { createTestApp, TestContext, TestUser } from './utils/test-app';

describe('Workspaces, membership & invitations (e2e)', () => {
  let ctx: TestContext;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let acme: string;

  const invite = (
    by: TestUser,
    workspaceId: string,
    email: string,
    role: string,
  ) =>
    ctx
      .as(by)
      .post(`/workspaces/${workspaceId}/invitations`)
      .send({ email, role });

  const join = async (
    user: TestUser,
    workspaceId: string,
    role: string,
    by = alice,
  ) => {
    const inv = await invite(by, workspaceId, user.email, role).expect(201);
    await ctx.as(user).post(`/invitations/${inv.body._id}/accept`).expect(201);
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    [alice, bob, carol] = await Promise.all([
      ctx.signUp('alice'),
      ctx.signUp('bob'),
      ctx.signUp('carol'),
    ]);
    const res = await ctx
      .as(alice)
      .post('/workspaces')
      .send({ name: 'Acme' })
      .expect(201);
    acme = res.body._id;
    expect(res.body.role).toBe('OWNER');
  });
  afterAll(() => ctx.close());

  it('hides workspaces the user does not belong to (404, not 403)', async () => {
    await ctx.as(bob).get(`/workspaces/${acme}`).expect(404);
    await ctx.as(bob).get(`/workspaces/${acme}/members`).expect(404);
    await ctx.as(bob).get(`/workspaces/${acme}/projects`).expect(404);
    await ctx
      .as(bob)
      .post(`/workspaces/${acme}/projects`)
      .send({ name: 'x' })
      .expect(404);
  });

  it('lets one user hold different roles in different workspaces', async () => {
    const bobsOrg = await ctx
      .as(bob)
      .post('/workspaces')
      .send({ name: 'Bob Co' })
      .expect(201);
    await join(bob, acme, 'MEMBER');

    const res = await ctx.as(bob).get('/workspaces').expect(200);
    const roles = Object.fromEntries(res.body.map((w) => [w.name, w.role]));
    expect(roles).toEqual({
      Personal: 'OWNER',
      'Bob Co': 'OWNER',
      Acme: 'MEMBER',
    });
    expect(res.body[0].type).toBe('PERSONAL');

    // Bob is OWNER in his org but cannot act as one in Acme.
    await ctx
      .as(bob)
      .patch(`/workspaces/${bobsOrg.body._id}`)
      .send({ name: 'Bob Inc' })
      .expect(200);
    await ctx
      .as(bob)
      .patch(`/workspaces/${acme}`)
      .send({ name: 'Hacked' })
      .expect(403);
  });

  it('prevents duplicate pending invitations and duplicate membership', async () => {
    await invite(alice, acme, carol.email, 'MEMBER').expect(201);
    await invite(alice, acme, carol.email, 'ADMIN').expect(409);
    await invite(alice, acme, bob.email, 'MEMBER').expect(409); // already a member

    const [pending] = (await ctx.as(carol).get('/invitations').expect(200))
      .body;
    await ctx.as(carol).post(`/invitations/${pending._id}/accept`).expect(201);
    await ctx.as(carol).post(`/invitations/${pending._id}/accept`).expect(409);

    const members = await ctx
      .as(alice)
      .get(`/workspaces/${acme}/members`)
      .expect(200);
    const carolRows = members.body.items.filter((m) => m.user._id === carol.id);
    expect(carolRows).toHaveLength(1);
    expect(members.body.items[0].user).not.toHaveProperty('password');
  });

  it('only lets the invitee accept their invitation', async () => {
    const dave = await ctx.signUp('dave');
    const inv = await invite(alice, acme, dave.email, 'VIEWER').expect(201);
    await ctx.as(bob).post(`/invitations/${inv.body._id}/accept`).expect(404);
    await ctx.as(dave).post(`/invitations/${inv.body._id}/decline`).expect(204);
    await ctx.as(dave).post(`/invitations/${inv.body._id}/accept`).expect(409);
  });

  it('supports inviting an email that registers later', async () => {
    const email = `newcomer.${Date.now()}@taskify.test`;
    await invite(alice, acme, email, 'MEMBER').expect(201);
    expect(
      ctx.emails.sent.some((m) => m.to === email && /Acme/.test(m.subject)),
    ).toBe(true);

    const auth = ctx.app.get(
      (await import('../src/auth/auth.service')).AuthService,
    );
    await auth.register({
      firstName: 'New',
      lastName: 'Comer',
      email,
      userName: `newcomer${Date.now()}`,
      password: 'Password@123',
    });
    const verified = await auth.verifyEmail({
      email,
      otp: ctx.emails.lastOtpFor(email),
    });
    const newcomer = {
      id: String(verified.user._id),
      email,
      userName: '',
      token: verified.accessToken,
    };

    const [pending] = (await ctx.as(newcomer).get('/invitations').expect(200))
      .body;
    expect(pending.workspace.name).toBe('Acme');
    await ctx
      .as(newcomer)
      .post(`/invitations/${pending._id}/accept`)
      .expect(201);
    await ctx.as(newcomer).get(`/workspaces/${acme}`).expect(200);
  });

  it('blocks members without permission from inviting or managing members', async () => {
    const erin = await ctx.signUp('erin');
    await invite(bob, acme, erin.email, 'MEMBER').expect(403);
    await ctx
      .as(bob)
      .patch(`/workspaces/${acme}/members/${carol.id}`)
      .send({ role: 'ADMIN' })
      .expect(403);
    await ctx
      .as(bob)
      .delete(`/workspaces/${acme}/members/${carol.id}`)
      .expect(403);
  });

  it('enforces the role hierarchy for admins', async () => {
    const frank = await ctx.signUp('frank');
    await join(frank, acme, 'ADMIN');

    // Admins can manage lower roles…
    await ctx
      .as(frank)
      .patch(`/workspaces/${acme}/members/${carol.id}`)
      .send({ role: 'MANAGER' })
      .expect(200);
    // …but cannot grant ADMIN/OWNER, nor touch the owner.
    await ctx
      .as(frank)
      .patch(`/workspaces/${acme}/members/${carol.id}`)
      .send({ role: 'ADMIN' })
      .expect(403);
    await ctx
      .as(frank)
      .patch(`/workspaces/${acme}/members/${alice.id}`)
      .send({ role: 'VIEWER' })
      .expect(403);
    await ctx
      .as(frank)
      .delete(`/workspaces/${acme}/members/${alice.id}`)
      .expect(403);
    await invite(frank, acme, 'boss@taskify.test', 'ADMIN').expect(403);
    await ctx.as(frank).delete(`/workspaces/${acme}`).expect(403);

    // Owner can promote, and members can leave on their own.
    await ctx
      .as(alice)
      .patch(`/workspaces/${acme}/members/${carol.id}`)
      .send({ role: 'ADMIN' })
      .expect(200);
    await ctx
      .as(alice)
      .delete(`/workspaces/${acme}/members/${alice.id}`)
      .expect(400); // owner cannot leave
    await ctx
      .as(frank)
      .delete(`/workspaces/${acme}/members/${frank.id}`)
      .expect(204);
    await ctx.as(frank).get(`/workspaces/${acme}`).expect(404);
  });

  it('keeps personal workspaces private', async () => {
    const personal = (await ctx.as(alice).get('/workspaces').expect(200))
      .body[0];
    expect(personal.type).toBe('PERSONAL');
    await invite(alice, personal._id, bob.email, 'MEMBER').expect(400);
    await ctx.as(alice).delete(`/workspaces/${personal._id}`).expect(400);
  });

  it('makes a deleted workspace unreachable for everyone', async () => {
    const temp = await ctx
      .as(alice)
      .post('/workspaces')
      .send({ name: 'Temp' })
      .expect(201);
    await ctx.as(alice).delete(`/workspaces/${temp.body._id}`).expect(204);
    await ctx.as(alice).get(`/workspaces/${temp.body._id}`).expect(404);
  });
});
