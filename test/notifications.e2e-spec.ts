import { createTestApp, TestContext, TestUser } from './utils/test-app';

describe('Notifications inbox (e2e)', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let invitee: TestUser;
  let other: TestUser;

  const inbox = async (user: TestUser) =>
    (await ctx.as(user).get('/notifications').expect(200)).body.items as {
      _id: string;
    }[];

  beforeAll(async () => {
    ctx = await createTestApp();
    [owner, invitee, other] = await Promise.all(
      ['owner', 'invitee', 'other'].map((n) => ctx.signUp(n)),
    );
    // Two invitations → two notifications for the invitee.
    for (const name of ['One', 'Two']) {
      const ws = (
        await ctx.as(owner).post('/workspaces').send({ name }).expect(201)
      ).body._id;
      await ctx
        .as(owner)
        .post(`/workspaces/${ws}/invitations`)
        .send({ email: invitee.email, role: 'MEMBER' })
        .expect(201);
    }
  });
  afterAll(() => ctx.close());

  it('deletes one notification, only for its recipient', async () => {
    const [first] = await inbox(invitee);
    await ctx.as(other).delete(`/notifications/${first._id}`).expect(404);
    await ctx.as(invitee).delete(`/notifications/${first._id}`).expect(204);
    expect((await inbox(invitee)).map((n) => n._id)).not.toContain(first._id);
  });

  it('clears read ones, then everything', async () => {
    const [remaining] = await inbox(invitee);
    await ctx.as(invitee).patch(`/notifications/${remaining._id}/read`);
    const readOnly = await ctx
      .as(invitee)
      .delete('/notifications?readOnly=true')
      .expect(200);
    expect(readOnly.body.deleted).toBe(1);

    await ctx.as(invitee).delete('/notifications').expect(200);
    expect(await inbox(invitee)).toHaveLength(0);
  });
});
