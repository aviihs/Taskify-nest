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
  const next = <T>(socket: Socket, event: string, ms = 1000) =>
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
});
