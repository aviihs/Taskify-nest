import { AddressInfo } from 'net';
import { io, Socket } from 'socket.io-client';
import { createTestApp, TestContext, TestUser } from './utils/test-app';

describe('Realtime gateway (e2e)', () => {
  let ctx: TestContext;
  let url: string;
  let owner: TestUser;
  let outsider: TestUser;
  let project: string;
  const sockets: Socket[] = [];

  const connect = (token?: string) =>
    new Promise<Socket>((resolve, reject) => {
      const socket = io(url, {
        auth: token ? { token } : {},
        transports: ['websocket'],
        reconnection: false,
      });
      sockets.push(socket);
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  const next = <T>(socket: Socket, event: string, ms = 5000) =>
    new Promise<T | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), ms);
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

  const request = (socket: Socket, event: string, payload: unknown) =>
    new Promise((resolve) => socket.emit(event, payload, resolve));

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.app.listen(0);
    const { port } = ctx.app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${port}/realtime`;
    [owner, outsider] = await Promise.all([
      ctx.signUp('owner'),
      ctx.signUp('outsider'),
    ]);
    const personal = (await ctx.as(owner).get('/workspaces').expect(200))
      .body[0]._id;
    project = (
      await ctx
        .as(owner)
        .post(`/workspaces/${personal}/projects`)
        .send({ name: 'Live' })
        .expect(201)
    ).body._id;
  });
  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await ctx.close();
  });

  it('rejects unauthenticated connections', async () => {
    const socket = await connect();
    expect(await next(socket, 'disconnect')).toBeTruthy();
  });

  it('only lets authorized users subscribe, then streams task changes', async () => {
    const intruder = await connect(outsider.token);
    const denied = await request(intruder, 'subscribe', { projectId: project });
    expect(denied).toEqual({ ok: false, error: 'Not found' });

    const client = await connect(owner.token);
    const ack = await request(client, 'subscribe', { projectId: project });
    expect(ack).toEqual({ ok: true });

    const received = next<{ type: string; projectId: string }>(client, 'event');
    const leaked = next(intruder, 'event', 300);
    await ctx
      .as(owner)
      .post(`/projects/${project}/tasks`)
      .send({ title: 'Live task' })
      .expect(201);

    expect(await received).toMatchObject({
      type: 'task.created',
      projectId: project,
    });
    expect(await leaked).toBeNull();
  });

  it('keeps both sides of an invitation live: invite, decline, cancel', async () => {
    const acme = (
      await ctx.as(owner).post('/workspaces').send({ name: 'Acme' }).expect(201)
    ).body._id;
    const admin = await connect(owner.token);
    expect(await request(admin, 'subscribe', { workspaceId: acme })).toEqual({
      ok: true,
    });
    const invitee = await connect(outsider.token);

    // Invite → invitee hears about it instantly (notification + invitation).
    const invitedSignal = next<{ type: string }>(invitee, 'invitation');
    const notified = next(invitee, 'notification');
    const first = (
      await ctx
        .as(owner)
        .post(`/workspaces/${acme}/invitations`)
        .send({ email: outsider.email, role: 'MEMBER' })
        .expect(201)
    ).body;
    expect(await invitedSignal).toMatchObject({ type: 'invitation.created' });
    expect(await notified).toBeTruthy();

    // Decline → the admin's workspace room hears it.
    const declined = next<{ type: string }>(admin, 'event');
    await ctx
      .as(outsider)
      .post(`/invitations/${first._id}/decline`)
      .expect(204);
    expect(await declined).toMatchObject({ type: 'invitation.declined' });

    // Re-invite, then cancel → the invitee hears it. Listen first and skip
    // the re-invite's own 'invitation.created', whenever it arrives.
    const cancelled = new Promise<{ type: string } | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 5000);
      const handler = (payload: { type: string }) => {
        if (payload.type !== 'invitation.cancelled') return;
        clearTimeout(timer);
        invitee.off('invitation', handler);
        resolve(payload);
      };
      invitee.on('invitation', handler);
    });
    const second = (
      await ctx
        .as(owner)
        .post(`/workspaces/${acme}/invitations`)
        .send({ email: outsider.email, role: 'VIEWER' })
        .expect(201)
    ).body;
    await ctx
      .as(owner)
      .delete(`/workspaces/${acme}/invitations/${second._id}`)
      .expect(204);
    expect(await cancelled).toMatchObject({ type: 'invitation.cancelled' });
  });

  it('disconnects a member whose role is lowered or who is suspended', async () => {
    const org = (
      await ctx
        .as(owner)
        .post('/workspaces')
        .send({ name: 'Revoke' })
        .expect(201)
    ).body._id;
    const member = await ctx.signUp('revoked');
    const inv = await ctx
      .as(owner)
      .post(`/workspaces/${org}/invitations`)
      .send({ email: member.email, role: 'MANAGER' })
      .expect(201);
    await ctx
      .as(member)
      .post(`/invitations/${inv.body._id}/accept`)
      .expect(201);

    let socket = await connect(member.token);
    let dropped = next(socket, 'disconnect');
    await ctx
      .as(owner)
      .patch(`/workspaces/${org}/members/${member.id}`)
      .send({ role: 'VIEWER' })
      .expect(200);
    expect(await dropped).toBeTruthy();

    socket = await connect(member.token);
    dropped = next(socket, 'disconnect');
    await ctx
      .as(owner)
      .patch(`/workspaces/${org}/members/${member.id}`)
      .send({ status: 'SUSPENDED' })
      .expect(200);
    expect(await dropped).toBeTruthy();
  });
});
