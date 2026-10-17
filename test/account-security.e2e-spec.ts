import { getModelToken } from '@nestjs/mongoose';
import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { Model, Types } from 'mongoose';
import { join } from 'path';
import { createTestApp, TestContext, TestUser } from './utils/test-app';

// A 1x1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('Account security (e2e)', () => {
  let ctx: TestContext;
  let users: Model<{
    avatar?: string;
    isActive?: boolean;
    phone?: unknown;
  }>;

  beforeAll(async () => {
    ctx = await createTestApp();
    users = ctx.app.get(getModelToken('User'));
  });
  afterAll(() => ctx.close());

  describe('phone', () => {
    let user: TestUser;

    beforeEach(async () => {
      user = await ctx.signUp('phone');
    });

    it.each(['981234567', '98123456789', '9612345678', '0812345678', 'abc'])(
      'rejects %s',
      async (phone) => {
        await ctx.as(user).put('/auth/profile').send({ phone }).expect(400);
      },
    );

    it('normalises a Nepali number and lets it be cleared', async () => {
      const res = await ctx
        .as(user)
        .put('/auth/profile')
        .send({ phone: '+977 981-234-5678' })
        .expect(200);
      expect(res.body.data.phone).toBe('9812345678');

      const kept = await ctx
        .as(user)
        .put('/auth/profile')
        .send({ phone: '9771234567' })
        .expect(200);
      expect(kept.body.data.phone).toBe('9771234567');

      const cleared = await ctx
        .as(user)
        .put('/auth/profile')
        .send({ phone: '' })
        .expect(200);
      expect(cleared.body.data.phone).toBeNull();
    });

    it('serves a legacy numeric phone as a string', async () => {
      await users.collection.updateOne(
        { _id: new Types.ObjectId(user.id) },
        { $set: { phone: 9812345678 } },
      );
      const res = await ctx
        .as(user)
        .put('/auth/profile')
        .send({ bio: 'hi' })
        .expect(200);
      expect(res.body.data.phone).toBe('9812345678');
    });
  });

  describe('name', () => {
    it('updates first and last name, trimmed, and rejects blanks', async () => {
      const user = await ctx.signUp('rename');
      const updated = await ctx
        .as(user)
        .put('/auth/profile')
        .send({ firstName: '  Sita ', lastName: 'Sharma' })
        .expect(200);
      expect(updated.body.data).toMatchObject({
        firstName: 'Sita',
        lastName: 'Sharma',
      });
      await ctx
        .as(user)
        .put('/auth/profile')
        .send({ firstName: '   ' })
        .expect(400);
      await ctx
        .as(user)
        .put('/auth/profile')
        .send({ lastName: 'x'.repeat(51) })
        .expect(400);
    });
  });

  describe('avatar', () => {
    let user: TestUser;
    let victimFile: string;

    beforeEach(async () => {
      user = await ctx.signUp('avatar');
      // A file the process can reach that is not an avatar.
      const dir = join(process.env.UPLOAD_DIR, 'attachments', 'victim');
      await mkdir(dir, { recursive: true });
      victimFile = join(dir, `${user.userName}.txt`);
      await writeFile(victimFile, 'secret');
    });

    it('rejects a server path as avatar on profile update', async () => {
      await ctx
        .as(user)
        .put('/auth/profile')
        .send({ avatar: victimFile })
        .expect(400);
      await ctx
        .as(user)
        .put('/auth/profile')
        .send({ avatar: 'package.json' })
        .expect(400);
    });

    it('accepts an https URL and the unchanged current value', async () => {
      const url = 'https://example.com/me.png';
      await ctx
        .as(user)
        .put('/auth/profile')
        .send({ avatar: url, bio: 'hi' })
        .expect(200);
      // What the mobile app sends back on every later save.
      const res = await ctx
        .as(user)
        .put('/auth/profile')
        .send({ avatar: url, bio: 'again' })
        .expect(200);
      expect(res.body.data.avatar).toBe(url);
    });

    it('never serves or deletes a stored value outside the avatar directory', async () => {
      // Simulates a value written before this fix (or by a raw import).
      await users.updateOne({ _id: user.id }, { avatar: victimFile }).exec();

      await ctx.as(user).get(`/users/${user.id}/avatar`).expect(404);
      await ctx
        .as(user)
        .post('/users/me/avatar')
        .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })
        .expect(201);
      expect(existsSync(victimFile)).toBe(true);
    });

    it('serves an uploaded avatar and removes the old file on replace', async () => {
      const first = (
        await ctx
          .as(user)
          .post('/users/me/avatar')
          .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })
          .expect(201)
      ).body.avatar;
      await ctx.as(user).get(`/users/${user.id}/avatar`).expect(200);
      await ctx
        .as(user)
        .post('/users/me/avatar')
        .attach('file', PNG, { filename: 'b.png', contentType: 'image/png' })
        .expect(201);
      expect(existsSync(first)).toBe(false);
    });
  });

  describe('deactivated accounts', () => {
    it('cannot reactivate themselves through the profile', async () => {
      const user = await ctx.signUp('selfactive');
      await ctx
        .as(user)
        .put('/auth/profile')
        .send({ isActive: true })
        .expect(400);
    });

    it('cannot log in or refresh', async () => {
      const user = await ctx.signUp('inactive');
      const login = await ctx
        .http()
        .post('/auth/login')
        .send({ email: user.email, password: 'Password@123' })
        .expect(201);
      await users.updateOne({ _id: user.id }, { isActive: false }).exec();

      await ctx
        .http()
        .post('/auth/login')
        .send({ email: user.email, password: 'Password@123' })
        .expect(403);
      await ctx
        .http()
        .post('/auth/refresh')
        .send({ token: login.body.refreshToken })
        .expect(403);
    });
  });
});
