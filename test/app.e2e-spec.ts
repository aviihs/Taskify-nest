import { createTestApp, TestContext } from './utils/test-app';

describe('Auth & personal workspace (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => ctx.close());

  it('registration creates exactly one personal workspace owned by the user', async () => {
    const email = 'shiva@taskify.test';
    await ctx
      .http()
      .post('/auth/register')
      .send({
        firstName: 'Shiva',
        lastName: 'Bhusal',
        email,
        userName: 'shiva',
        password: 'Password@123',
      })
      .expect(201);

    const verify = await ctx
      .http()
      .post('/auth/verify-email')
      .send({ email, otp: ctx.emails.lastOtpFor(email) })
      .expect(201);
    const token = verify.body.accessToken;

    const res = await ctx
      .http()
      .get('/workspaces')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      type: 'PERSONAL',
      role: 'OWNER',
      memberCount: 1,
    });
    expect(res.body[0].permissions).toContain('workspace:delete');
  });

  it('never exposes password hashes, refresh tokens or OTPs', async () => {
    const user = await ctx.signUp('secretive');
    const me = await ctx.as(user).get('/users/me').expect(200);
    for (const field of [
      'password',
      'refreshTokens',
      'emailOtp',
      'passwordResetToken',
    ]) {
      expect(me.body).not.toHaveProperty(field);
    }
    // Listing every user is a platform-admin capability.
    await ctx.as(user).get('/users').expect(403);
  });

  it('rejects a refresh token used as an access token', async () => {
    const user = await ctx.signUp('refresher');
    const login = await ctx
      .http()
      .post('/auth/login')
      .send({ email: user.email, password: 'Password@123' })
      .expect(201);

    await ctx
      .http()
      .get('/workspaces')
      .set('Authorization', `Bearer ${login.body.refreshToken}`)
      .expect(401);

    const refreshed = await ctx
      .http()
      .post('/auth/refresh')
      .send({ token: login.body.refreshToken })
      .expect(201);
    expect(refreshed.body.accessToken).toBeDefined();

    // Rotation: the old refresh token is single-use.
    await ctx
      .http()
      .post('/auth/refresh')
      .send({ token: login.body.refreshToken })
      .expect(401);
  });

  it('returns a consistent error body', async () => {
    const res = await ctx.http().get('/workspaces').expect(401);
    expect(res.body).toMatchObject({
      success: false,
      statusCode: 401,
      path: '/workspaces',
    });
    expect(res.body.message).toBeDefined();
    expect(res.body.timestamp).toBeDefined();
  });

  it('rejects malformed ids and invalid payloads with 400', async () => {
    const user = await ctx.signUp('validator');
    await ctx.as(user).get('/workspaces/not-an-id').expect(400);
    const res = await ctx
      .as(user)
      .post('/workspaces')
      .send({ name: '' })
      .expect(400);
    expect(Array.isArray(res.body.message)).toBe(true);
    await ctx
      .as(user)
      .post('/workspaces')
      .send({ name: 'Ok', role: 'OWNER' })
      .expect(400); // unknown properties are rejected
  });
});
