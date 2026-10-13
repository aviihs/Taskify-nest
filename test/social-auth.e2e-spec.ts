import { UnauthorizedException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { randomUUID } from 'crypto';
import { Model } from 'mongoose';
import { AuthService } from '../src/auth/auth.service';
import {
  FirebaseIdentity,
  FirebaseTokenVerifier,
} from '../src/auth/social/firebase-token.verifier';
import { WorkspacesService } from '../src/workspaces/workspaces.service';
import { createTestApp, TestContext } from './utils/test-app';

/** Stands in for Firebase: an ID token is just a key into this map. */
class FakeFirebaseVerifier {
  readonly identities = new Map<string, FirebaseIdentity>();

  issue(overrides: Partial<FirebaseIdentity> = {}): string {
    const token = `token-${randomUUID()}`;
    const uid = overrides.uid ?? `uid-${randomUUID()}`;
    this.identities.set(token, {
      uid,
      provider: 'google.com',
      email: `${uid}@gmail.test`,
      emailVerified: true,
      name: 'Social Tester',
      picture: null,
      ...overrides,
    });
    return token;
  }

  async verify(idToken: string): Promise<FirebaseIdentity> {
    const identity = this.identities.get(idToken);
    if (!identity) {
      throw new UnauthorizedException('Invalid or expired sign-in token.');
    }
    return identity;
  }
}

describe('Social auth via Firebase (e2e)', () => {
  let ctx: TestContext;
  let firebase: FakeFirebaseVerifier;
  let auth: AuthService;
  let users: Model<{ email: string; isActive: boolean }>;
  let identities: Model<{ firebaseUid: string; user: unknown }>;
  let workspaces: Model<{ owner: unknown; type: string }>;

  beforeAll(async () => {
    firebase = new FakeFirebaseVerifier();
    ctx = await createTestApp({
      overrides: [[FirebaseTokenVerifier, firebase]],
    });
    auth = ctx.app.get(AuthService);
    users = ctx.app.get(getModelToken('User'));
    identities = ctx.app.get(getModelToken('UserIdentity'));
    workspaces = ctx.app.get(getModelToken('Workspace'));
  });
  afterAll(() => ctx.close());

  // HTTP for the contract; the service directly elsewhere, so the credential
  // rate limit (10/min) isn't hit.
  it('rejects an invalid token over HTTP', async () => {
    const res = await ctx
      .http()
      .post('/auth/firebase')
      .send({ idToken: 'not-a-real-token' })
      .expect(401);
    expect(res.body.accessToken).toBeUndefined();
  });

  it('requires an idToken', async () => {
    await ctx.http().post('/auth/firebase').send({}).expect(400);
  });

  it('creates an account on first sign-in, with the login response shape', async () => {
    const token = firebase.issue({ name: 'Ada Lovelace' });
    const res = await ctx
      .http()
      .post('/auth/firebase')
      .send({ idToken: token })
      .expect(201);

    expect(res.body).toMatchObject({
      success: true,
      message: 'Login successful',
    });
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({
      firstName: 'Ada',
      lastName: 'Lovelace',
      isEmailVerified: true,
      isActive: true,
    });
    expect(res.body.user.password).toBeUndefined();

    const userId = res.body.user._id;
    expect(await identities.countDocuments({ user: userId })).toBe(1);
    expect(
      await workspaces.countDocuments({ owner: userId, type: 'PERSONAL' }),
    ).toBe(1);

    // The issued Taskify JWT works on protected routes and refresh rotates.
    await ctx
      .http()
      .get('/workspaces')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(200);
    await ctx
      .http()
      .post('/auth/refresh')
      .send({ token: res.body.refreshToken })
      .expect(201);
  });

  it('logs a linked identity into the same user without duplicating it', async () => {
    const uid = `uid-${randomUUID()}`;
    const first = await auth.firebaseLogin({
      idToken: firebase.issue({ uid }),
    });
    // Same Firebase account, later session, provider now reports a new email.
    const again = await auth.firebaseLogin({
      idToken: firebase.issue({ uid, email: `changed-${uid}@gmail.test` }),
    });

    expect(String(again.user._id)).toBe(String(first.user._id));
    expect(await identities.countDocuments({ firebaseUid: uid })).toBe(1);
    expect(await users.countDocuments({ email: first.user.email })).toBe(1);
  });

  it('never links to an existing password account by email', async () => {
    const existing = await ctx.signUp('password');
    const token = firebase.issue({ email: existing.email });

    const res = await ctx
      .http()
      .post('/auth/firebase')
      .send({ idToken: token })
      .expect(409);
    expect(res.body.code).toBe('ACCOUNT_EXISTS');
    expect(res.body.accessToken).toBeUndefined();
    expect(await users.countDocuments({ email: existing.email })).toBe(1);
    expect(await identities.countDocuments({ email: existing.email })).toBe(0);
  });

  it('rejects a deactivated linked user', async () => {
    const uid = `uid-${randomUUID()}`;
    const first = await auth.firebaseLogin({
      idToken: firebase.issue({ uid }),
    });
    await users.updateOne({ _id: first.user._id }, { isActive: false });

    await expect(
      auth.firebaseLogin({ idToken: firebase.issue({ uid }) }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses to create an account from an unverified email', async () => {
    const token = firebase.issue({ emailVerified: false });
    await expect(auth.firebaseLogin({ idToken: token })).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({ code: 'EMAIL_NOT_VERIFIED' }),
    });
    const { email } = await firebase.verify(token);
    expect(await users.countDocuments({ email })).toBe(0);
  });

  it('refuses to create an account without an email', async () => {
    await expect(
      auth.firebaseLogin({ idToken: firebase.issue({ email: null }) }),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ code: 'EMAIL_REQUIRED' }),
    });
  });

  it('creates exactly one account for concurrent first sign-ins', async () => {
    const uid = `uid-${randomUUID()}`;
    const tokens = [1, 2, 3].map(() => firebase.issue({ uid }));

    const results = await Promise.all(
      tokens.map((idToken) => auth.firebaseLogin({ idToken })),
    );

    const ids = new Set(results.map((r) => String(r.user._id)));
    expect(ids.size).toBe(1);
    expect(await identities.countDocuments({ firebaseUid: uid })).toBe(1);
    expect(await users.countDocuments({ email: `${uid}@gmail.test` })).toBe(1);
  });

  it('picks a different username when the email-based one is taken', async () => {
    const a = await auth.firebaseLogin({
      idToken: firebase.issue({ email: `same.local@one-${randomUUID()}.test` }),
    });
    const b = await auth.firebaseLogin({
      idToken: firebase.issue({ email: `same.local@two-${randomUUID()}.test` }),
    });
    expect(a.user.userName).not.toBe(b.user.userName);
  });

  it('leaves no partial records when account creation fails', async () => {
    const workspacesService = ctx.app.get(WorkspacesService);
    const spy = jest
      .spyOn(workspacesService, 'ensurePersonalWorkspace')
      .mockRejectedValueOnce(new Error('workspace insert failed'));
    const uid = `uid-${randomUUID()}`;
    const email = `${uid}@gmail.test`;

    try {
      await expect(
        auth.firebaseLogin({ idToken: firebase.issue({ uid }) }),
      ).rejects.toThrow('workspace insert failed');
    } finally {
      spy.mockRestore();
    }

    expect(await users.countDocuments({ email })).toBe(0);
    expect(await identities.countDocuments({ firebaseUid: uid })).toBe(0);

    // A retry then succeeds cleanly.
    const retry = await auth.firebaseLogin({
      idToken: firebase.issue({ uid }),
    });
    expect(retry.user.email).toBe(email);
  });

  it('keeps email/password login working', async () => {
    const user = await ctx.signUp('classic');
    const res = await ctx
      .http()
      .post('/auth/login')
      .send({ email: user.email, password: 'Password@123' })
      .expect(201);
    expect(res.body.accessToken).toEqual(expect.any(String));
  });
});
