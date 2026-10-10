import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createTestApp, TestContext, TestUser } from './utils/test-app';

/**
 * Regression: a global RolesGuard ran before the global JwtAuthGuard, so it
 * never saw the user and every platform-admin route answered 403.
 */
describe('Platform admin users (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let normal: TestUser;

  beforeAll(async () => {
    ctx = await createTestApp();
    const admin = await ctx.signUp('boss');
    normal = await ctx.signUp('normal');
    const users = ctx.app.get<Model<unknown>>(getModelToken('User'));
    await users.updateOne({ _id: admin.id }, { role: 'ADMIN' }).exec();
    // Log in again so the token carries the ADMIN role.
    adminToken = (
      await ctx
        .http()
        .post('/auth/login')
        .send({ email: admin.email, password: 'Password@123' })
        .expect(201)
    ).body.accessToken;
  });
  afterAll(() => ctx.close());

  const asAdmin = (url: string) =>
    ctx.http().get(url).set('Authorization', `Bearer ${adminToken}`);

  it('lets an admin list and filter users', async () => {
    const all = await asAdmin('/users?limit=100').expect(200);
    expect(all.body.total).toBeGreaterThanOrEqual(2);
    const admins = await asAdmin('/users?role=ADMIN').expect(200);
    expect(admins.body.items).toHaveLength(1);
    await asAdmin('/users?isActive=true').expect(200);
  });

  it('lets an admin deactivate and reactivate a user', async () => {
    await ctx
      .http()
      .patch(`/users/${normal.id}/deactivate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const inactive = await asAdmin('/users?isActive=false').expect(200);
    expect(inactive.body.items.map((u: { _id: string }) => u._id)).toContain(
      normal.id,
    );
    await ctx
      .http()
      .patch(`/users/${normal.id}/activate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('still forbids normal users', async () => {
    await ctx.as(normal).get('/users').expect(403);
  });
});
