import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AddressInfo } from 'net';
import { io, Socket } from 'socket.io-client';
import { createTestApp, TestContext, TestUser } from './utils/test-app';

const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));

describe('Chat, typing & presence (e2e)', () => {
  let ctx: TestContext;
  let url: string;
  let owner: TestUser;
  let dev: TestUser;
  let outsider: TestUser;
  let acme: string;
  let conversation: string;
  const sockets: Socket[] = [];

  const connect = (user: TestUser) =>
    new Promise<Socket>((resolve, reject) => {
      const socket = io(url, {
        auth: { token: user.token },
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
  /** Every payload of an event received within `ms`. */
  const collect = <T>(socket: Socket, event: string, ms: number) =>
    new Promise<T[]>((resolve) => {
      const seen: T[] = [];
      const handler = (payload: T) => seen.push(payload);
      socket.on(event, handler);
      setTimeout(() => {
        socket.off(event, handler);
        resolve(seen);
      }, ms);
    });
  /** The next presence update about one user (others' updates are skipped). */
  const presenceOf = (socket: Socket, userId: string, ms = 1000) =>
    new Promise<{ userId: string; online: boolean } | null>((resolve) => {
      const handler = (p: { userId: string; online: boolean }) => {
        if (p.userId !== userId) return;
        clearTimeout(timer);
        socket.off('presence', handler);
        resolve(p);
      };
      const timer = setTimeout(() => {
        socket.off('presence', handler);
        resolve(null);
      }, ms);
      socket.on('presence', handler);
    });
  const request = <T>(socket: Socket, event: string, payload: unknown) =>
    new Promise<T>((resolve) => socket.emit(event, payload, resolve));

  const send = (user: TestUser, body: string, clientId?: string) =>
    ctx
      .as(user)
      .post(`/chat/conversations/${conversation}/messages`)
      .send({ body, ...(clientId && { clientId }) });

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.app.listen(0);
    const { port } = ctx.app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${port}/realtime`;
    [owner, dev, outsider] = await Promise.all(
      ['owner', 'dev', 'outsider'].map((n) => ctx.signUp(n)),
    );
    acme = (
      await ctx.as(owner).post('/workspaces').send({ name: 'Acme' }).expect(201)
    ).body._id;
    const inv = await ctx
      .as(owner)
      .post(`/workspaces/${acme}/invitations`)
      .send({ email: dev.email, role: 'MEMBER' })
      .expect(201);
    await ctx.as(dev).post(`/invitations/${inv.body._id}/accept`).expect(201);
  });
  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await ctx.close();
  });

  describe('conversations', () => {
    it('creates one direct conversation per pair, even under concurrent requests', async () => {
      const open = (user: TestUser, userId: string) =>
        ctx
          .as(user)
          .post('/chat/conversations')
          .send({ workspaceId: acme, userId });
      const results = await Promise.all([
        open(owner, dev.id),
        open(owner, dev.id),
        open(dev, owner.id),
      ]);
      results.forEach((r) => expect(r.status).toBe(201));
      const ids = new Set(results.map((r) => r.body._id));
      expect(ids.size).toBe(1);
      conversation = results[0].body._id;

      const view = results[0].body;
      expect(view.peer._id).toBe(dev.id);
      expect(view.peer.email).toBeUndefined(); // no private data in chat
      expect(view.workspace.name).toBe('Acme');
      expect(view.canSend).toBe(true);
    });

    it('rejects messaging yourself, outsiders and non-members', async () => {
      await ctx
        .as(owner)
        .post('/chat/conversations')
        .send({ workspaceId: acme, userId: owner.id })
        .expect(400);
      await ctx
        .as(owner)
        .post('/chat/conversations')
        .send({ workspaceId: acme, userId: outsider.id })
        .expect(404);
      await ctx
        .as(outsider)
        .post('/chat/conversations')
        .send({ workspaceId: acme, userId: owner.id })
        .expect(404);
      await ctx
        .as(owner)
        .post('/chat/conversations')
        .send({ workspaceId: 'nope', userId: dev.id })
        .expect(400);
    });

    it('keeps empty conversations out of the inbox', async () => {
      const list = await ctx.as(owner).get('/chat/conversations').expect(200);
      expect(list.body.items).toEqual([]);
    });
  });

  describe('messages', () => {
    it('validates input', async () => {
      await send(owner, '').expect(400);
      await send(owner, '   \n\t ').expect(400);
      await send(owner, 'x'.repeat(4001)).expect(400);
      await send(owner, 'hi', 'bad id!').expect(400);
      await ctx
        .as(owner)
        .post(`/chat/conversations/${conversation}/messages`)
        .send({ body: 'hi', senderId: dev.id }) // can't spoof the sender
        .expect(400);
      await ctx
        .as(owner)
        .get(`/chat/conversations/${conversation}/messages?before=5&after=1`)
        .expect(400);
    });

    it('persists messages in server order with server timestamps', async () => {
      const first = (
        await send(owner, '  Hello Dev  ', 'client-0001').expect(201)
      ).body;
      expect(first).toMatchObject({
        conversationId: conversation,
        senderId: owner.id,
        body: 'Hello Dev',
        seq: 1,
        clientId: 'client-0001',
      });
      expect(new Date(first.createdAt).getTime()).toBeLessThanOrEqual(
        Date.now(),
      );

      const reply = (await send(dev, 'Hi!').expect(201)).body;
      expect(reply.seq).toBe(2);
      expect(reply.senderId).toBe(dev.id);
    });

    it('treats a retried send with the same clientId as the same message', async () => {
      const a = (await send(owner, 'Once', 'client-0002').expect(201)).body;
      const b = (await send(owner, 'Once', 'client-0002').expect(201)).body;
      expect(b._id).toBe(a._id);
      const history = await ctx
        .as(owner)
        .get(`/chat/conversations/${conversation}/messages`)
        .expect(200);
      expect(history.body.items.filter((m) => m.body === 'Once')).toHaveLength(
        1,
      );
    });

    it('pages history backwards and catches up forwards', async () => {
      for (let i = 0; i < 5; i++) await send(dev, `Note ${i}`).expect(201);

      const latest = (
        await ctx
          .as(owner)
          .get(`/chat/conversations/${conversation}/messages?limit=3`)
          .expect(200)
      ).body;
      expect(latest.hasMore).toBe(true);
      const seqs = latest.items.map((m) => m.seq);
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b)); // ascending
      // The other person's messages never carry a clientId.
      expect(latest.items.every((m) => m.clientId === undefined)).toBe(true);

      const older = (
        await ctx
          .as(owner)
          .get(
            `/chat/conversations/${conversation}/messages?limit=3&before=${seqs[0]}`,
          )
          .expect(200)
      ).body;
      expect(Math.max(...older.items.map((m) => m.seq))).toBeLessThan(seqs[0]);

      const caughtUp = (
        await ctx
          .as(owner)
          .get(`/chat/conversations/${conversation}/messages?after=${seqs[0]}`)
          .expect(200)
      ).body;
      expect(caughtUp.items.map((m) => m.seq)).toEqual(seqs.slice(1));
      expect(caughtUp.hasMore).toBe(false);
    });

    it('hides conversations and messages from everyone else', async () => {
      const as = ctx.as(outsider);
      await as.get(`/chat/conversations/${conversation}`).expect(404);
      await as.get(`/chat/conversations/${conversation}/messages`).expect(404);
      await as
        .post(`/chat/conversations/${conversation}/messages`)
        .send({ body: 'let me in' })
        .expect(404);
      await as
        .post(`/chat/conversations/${conversation}/read`)
        .send({ seq: 1 })
        .expect(404);
      expect(
        (await as.get('/chat/conversations').expect(200)).body.items,
      ).toEqual([]);
      await ctx.http().get('/chat/conversations').expect(401);
    });
  });

  describe('unread and read state', () => {
    it('counts only the other person’s messages after my read marker', async () => {
      const list = (await ctx.as(owner).get('/chat/conversations').expect(200))
        .body.items;
      expect(list).toHaveLength(1);
      // Owner's own "Once" moved their marker past "Hi!": the 5 notes remain.
      expect(list[0].unreadCount).toBe(5);
      expect(list[0].lastMessage.preview).toBe('Note 4');
      expect(
        (await ctx.as(owner).get('/chat/unread-count').expect(200)).body.count,
      ).toBe(5);
      // Dev read everything when sending.
      expect(
        (await ctx.as(dev).get('/chat/unread-count').expect(200)).body.count,
      ).toBe(0);
    });

    it('marks read monotonically, clamped to the last message', async () => {
      const read = (seq: number) =>
        ctx
          .as(owner)
          .post(`/chat/conversations/${conversation}/read`)
          .send({ seq });
      const conv = (
        await ctx.as(owner).get(`/chat/conversations/${conversation}`)
      ).body;

      expect((await read(conv.lastSeq - 2).expect(200)).body.unreadCount).toBe(
        2,
      );
      // Going backwards is ignored.
      expect((await read(1).expect(200)).body.lastReadSeq).toBe(
        conv.lastSeq - 2,
      );
      // Beyond the last message is clamped.
      const all = (await read(10_000).expect(200)).body;
      expect(all).toEqual({ lastReadSeq: conv.lastSeq, unreadCount: 0 });

      const fromDev = (
        await ctx.as(dev).get(`/chat/conversations/${conversation}`)
      ).body;
      expect(fromDev.peerLastReadSeq).toBe(conv.lastSeq);
      await read(-1).expect(400);
    });
  });

  describe('realtime delivery', () => {
    it('delivers messages and read receipts only to participants', async () => {
      const ownerSocket = await connect(owner);
      const devSocket = await connect(dev);
      const outsiderSocket = await connect(outsider);

      const toDev = next<{
        message: Record<string, unknown>;
        sender: Record<string, unknown>;
      }>(devSocket, 'chat:message');
      const toOwner = next<{ message: Record<string, unknown> }>(
        ownerSocket,
        'chat:message',
      );
      const leaked = next(outsiderSocket, 'chat:message', 400);

      const sent = (await send(owner, 'Live!', 'client-live-1').expect(201))
        .body;
      const received = await toDev;
      expect(received?.message).toMatchObject({
        _id: sent._id,
        body: 'Live!',
        seq: sent.seq,
      });
      expect(received?.message.clientId).toBeUndefined();
      expect(received?.sender).toMatchObject({ _id: owner.id });
      expect(received?.sender.email).toBeUndefined();
      expect((await toOwner)?.message.clientId).toBe('client-live-1');
      expect(await leaked).toBeNull();

      const receipt = next<{ userId: string; lastReadSeq: number }>(
        ownerSocket,
        'chat:read',
      );
      await ctx
        .as(dev)
        .post(`/chat/conversations/${conversation}/read`)
        .send({ seq: sent.seq })
        .expect(200);
      expect(await receipt).toMatchObject({
        userId: dev.id,
        lastReadSeq: sent.seq,
      });
    });

    it('forwards authorized typing, throttles it, and clears it on disconnect', async () => {
      const ownerSocket = await connect(owner);
      const devSocket = await connect(dev);
      const outsiderSocket = await connect(outsider);

      const denied = await request<{ ok: boolean }>(
        outsiderSocket,
        'chat:typing',
        {
          conversationId: conversation,
          typing: true,
        },
      );
      expect(denied).toEqual({ ok: false, error: 'Not found' });

      const seen = collect<{ userId: string; typing: boolean }>(
        devSocket,
        'chat:typing',
        400,
      );
      for (let i = 0; i < 4; i++) {
        expect(
          await request(ownerSocket, 'chat:typing', {
            conversationId: conversation,
            typing: true,
          }),
        ).toEqual({ ok: true });
      }
      const typing = await seen;
      // Four keystroke events within the throttle window → one forwarded.
      expect(typing).toEqual([
        { conversationId: conversation, userId: owner.id, typing: true },
      ]);

      // Crash/close mid-typing → the peer is told typing stopped.
      const cleared = next<{ typing: boolean }>(devSocket, 'chat:typing');
      ownerSocket.disconnect();
      expect(await cleared).toMatchObject({ userId: owner.id, typing: false });
    });

    it('stops the typing indicator when a message is sent', async () => {
      const ownerSocket = await connect(owner);
      const devSocket = await connect(dev);
      await request(devSocket, 'chat:typing', {
        conversationId: conversation,
        typing: true,
      });
      const stopped = next<{ userId: string; typing: boolean }>(
        ownerSocket,
        'chat:typing',
      );
      await send(dev, 'done typing').expect(201);
      expect(await stopped).toMatchObject({ userId: dev.id, typing: false });
    });
  });

  describe('presence', () => {
    const devInContacts = async () => {
      const contacts = (
        await ctx
          .as(owner)
          .get(`/chat/contacts?workspaceId=${acme}`)
          .expect(200)
      ).body;
      return contacts.find((c) => c.user._id === dev.id);
    };

    beforeAll(async () => {
      sockets.forEach((s) => s.disconnect());
      await settle(150);
    });

    it('is online only while a socket is connected, across devices', async () => {
      expect((await devInContacts()).user.online).toBe(false);
      const watcher = await connect(owner);
      await ctx.as(owner).get(`/workspaces/${acme}`).expect(200); // an API call is not presence
      expect((await devInContacts()).user.online).toBe(false);

      // Clients follow their workspace rooms; presence fans out there.
      await request(watcher, 'subscribe', { workspaceId: acme });
      const cameOnline = presenceOf(watcher, dev.id);
      const phone = await connect(dev);
      expect(await cameOnline).toEqual({ userId: dev.id, online: true });
      const tablet = await connect(dev);
      const contact = await devInContacts();
      expect(contact.user.online).toBe(true);
      expect(contact.conversationId).toBe(conversation);

      phone.disconnect();
      await settle();
      expect((await devInContacts()).user.online).toBe(true); // tablet still on

      const wentOffline = presenceOf(watcher, dev.id);
      tablet.disconnect();
      expect(await wentOffline).toEqual({ userId: dev.id, online: false });
      expect((await devInContacts()).user.online).toBe(false);
    });

    it('respects "appear offline" while connected', async () => {
      await connect(dev);
      await settle();
      expect((await devInContacts()).user.online).toBe(true);

      const set = await ctx
        .as(dev)
        .patch('/chat/presence')
        .send({ availability: 'OFFLINE' })
        .expect(200);
      expect(set.body).toEqual({ availability: 'OFFLINE', online: false });
      expect((await devInContacts()).user.online).toBe(false);
      expect(
        (await ctx.as(dev).get('/chat/presence').expect(200)).body,
      ).toEqual({
        availability: 'OFFLINE',
        online: false,
      });

      await ctx
        .as(dev)
        .patch('/chat/presence')
        .send({ availability: 'AWAY' })
        .expect(400);
      await ctx
        .as(dev)
        .patch('/chat/presence')
        .send({ availability: 'ONLINE' })
        .expect(200);
      expect((await devInContacts()).user.online).toBe(true);
    });

    it('sweeps sessions left behind by a crashed server', async () => {
      const { PresenceService } = await import('../src/chat/presence.service');
      const { PresenceSession } = await import(
        '../src/chat/schemas/presence-session.schema'
      );
      sockets.forEach((s) => s.disconnect());
      await settle(150);

      const sessions = ctx.app.get<Model<unknown>>(
        getModelToken(PresenceSession.name),
      );
      await sessions.create({
        user: new Types.ObjectId(dev.id),
        socketId: 'ghost-socket',
        instanceId: 'dead-instance',
        lastSeenAt: new Date(Date.now() - 60_000),
      });
      expect((await devInContacts()).user.online).toBe(true); // still within grace

      const presence = ctx.app.get(PresenceService);
      expect(await presence.sweep(new Date(Date.now() + 60_000))).toBe(1);
      expect((await devInContacts()).user.online).toBe(false);
    });
  });

  describe('forward and delete', () => {
    const history = async (user: TestUser) =>
      (
        await ctx
          .as(user)
          .get(`/chat/conversations/${conversation}/messages?limit=100`)
          .expect(200)
      ).body.items as Array<Record<string, unknown>>;
    const remove = (
      user: TestUser,
      messageIds: string[],
      forEveryone = false,
    ) =>
      ctx
        .as(user)
        .post(`/chat/conversations/${conversation}/messages/delete`)
        .send({ messageIds, forEveryone });
    const inbox = async (user: TestUser) =>
      (await ctx.as(user).get('/chat/conversations').expect(200)).body
        .items as Array<{ _id: string; lastMessage: { preview: string } }>;

    it('marks forwarded messages', async () => {
      const sent = (
        await ctx
          .as(owner)
          .post(`/chat/conversations/${conversation}/messages`)
          .send({ body: 'Pass this on', forwarded: true })
          .expect(201)
      ).body;
      expect(sent).toMatchObject({ forwarded: true, deleted: false });
      expect((await send(owner, 'Plain').expect(201)).body.forwarded).toBe(
        false,
      );
    });

    it('deletes for me only, telling only my devices', async () => {
      const devSocket = await connect(dev);
      const ownerSocket = await connect(owner);
      const msg = (await send(dev, 'Only mine to hide').expect(201)).body;

      const mine = next<{ messageIds: string[] }>(devSocket, 'chat:deleted');
      const theirs = next(ownerSocket, 'chat:deleted', 400);
      await remove(dev, [msg._id]).expect(200);

      expect((await mine)?.messageIds).toEqual([msg._id]);
      expect(await theirs).toBeNull();
      expect((await history(dev)).some((m) => m._id === msg._id)).toBe(false);
      expect((await history(owner)).some((m) => m._id === msg._id)).toBe(true);
    });

    it('deletes my own messages for everyone, leaving a placeholder', async () => {
      const ownerSocket = await connect(owner);
      const msg = (await send(dev, 'Oops, wrong chat').expect(201)).body;

      // Not someone else's message, and not across conversations.
      await remove(owner, [msg._id], true).expect(403);
      await remove(dev, [new Types.ObjectId().toString()], true).expect(404);
      await remove(dev, [], true).expect(400);

      const toOwner = next<{ messageIds: string[]; forEveryone: boolean }>(
        ownerSocket,
        'chat:deleted',
      );
      await remove(dev, [msg._id], true).expect(200);
      expect(await toOwner).toMatchObject({
        messageIds: [msg._id],
        forEveryone: true,
      });

      for (const user of [owner, dev]) {
        const copy = (await history(user)).find((m) => m._id === msg._id);
        expect(copy).toMatchObject({ deleted: true, body: '' });
      }
      const stored = await ctx.app
        .get<Model<{ body: string }>>(getModelToken('ChatMessage'))
        .findById(msg._id)
        .lean()
        .exec();
      expect(stored?.body).toBe(''); // the text is really gone
      expect(
        (await inbox(owner)).find((c) => c._id === conversation)?.lastMessage
          .preview,
      ).toBe('Message deleted');
    });

    it('deleting a chat clears it for me until a new message arrives', async () => {
      const before = (await history(owner)).length;
      expect(before).toBeGreaterThan(0);

      await ctx
        .as(dev)
        .delete(`/chat/conversations/${conversation}`)
        .expect(204);
      expect(await history(dev)).toEqual([]);
      expect((await inbox(dev)).some((c) => c._id === conversation)).toBe(
        false,
      );
      expect(
        (await ctx.as(dev).get('/chat/unread-count').expect(200)).body.count,
      ).toBe(0);
      // The other person keeps everything.
      expect(await history(owner)).toHaveLength(before);

      const fresh = (await send(owner, 'Starting over').expect(201)).body;
      expect((await inbox(dev)).some((c) => c._id === conversation)).toBe(true);
      expect((await history(dev)).map((m) => m._id)).toEqual([fresh._id]);
    });
  });

  describe('workspaces and groups', () => {
    let designer: TestUser;
    let group: string;

    const join = async (workspaceId: string, user: TestUser) => {
      const inv = await ctx
        .as(owner)
        .post(`/workspaces/${workspaceId}/invitations`)
        .send({ email: user.email, role: 'MEMBER' })
        .expect(201);
      await ctx
        .as(user)
        .post(`/invitations/${inv.body._id}/accept`)
        .expect(201);
    };

    beforeAll(async () => {
      designer = await ctx.signUp('designer');
      await join(acme, designer);
    });

    it('keeps a separate chat per workspace and filters by workspace', async () => {
      const beta = (
        await ctx
          .as(owner)
          .post('/workspaces')
          .send({ name: 'Beta' })
          .expect(201)
      ).body._id;
      await join(beta, dev);
      const betaChat = (
        await ctx
          .as(owner)
          .post('/chat/conversations')
          .send({ workspaceId: beta, userId: dev.id })
          .expect(201)
      ).body._id;
      expect(betaChat).not.toBe(conversation);
      await ctx
        .as(owner)
        .post(`/chat/conversations/${betaChat}/messages`)
        .send({ body: 'Beta only' })
        .expect(201);

      const ids = async (workspaceId: string) =>
        (
          await ctx
            .as(dev)
            .get(`/chat/conversations?workspaceId=${workspaceId}`)
            .expect(200)
        ).body.items.map((c: { _id: string }) => c._id);
      expect(await ids(beta)).toEqual([betaChat]);
      expect(await ids(acme)).not.toContain(betaChat);
      expect(
        (
          await ctx
            .as(dev)
            .get(`/chat/unread-count?workspaceId=${beta}`)
            .expect(200)
        ).body.count,
      ).toBe(1);
      // Someone outside the workspace can't be messaged there.
      await ctx
        .as(owner)
        .post('/chat/conversations')
        .send({ workspaceId: beta, userId: designer.id })
        .expect(404);
    });

    it('validates groups', async () => {
      const create = (body: Record<string, unknown>) =>
        ctx.as(owner).post('/chat/groups').send(body);
      await create({
        workspaceId: acme,
        name: 'Duo',
        memberIds: [dev.id],
      }).expect(400);
      await create({
        workspaceId: acme,
        name: '   ',
        memberIds: [dev.id, designer.id],
      }).expect(400);
      await create({
        workspaceId: acme,
        name: 'Leak',
        memberIds: [dev.id, outsider.id],
      }).expect(404);
      await ctx
        .as(outsider)
        .post('/chat/groups')
        .send({
          workspaceId: acme,
          name: 'X',
          memberIds: [dev.id, designer.id],
        })
        .expect(404);
    });

    it('creates a group that every member sees and can chat in live', async () => {
      const devSocket = await connect(dev);
      const designerSocket = await connect(designer);
      const announced = next<{ conversationId: string }>(
        designerSocket,
        'chat:conversation',
      );
      const view = (
        await ctx
          .as(owner)
          .post('/chat/groups')
          .send({
            workspaceId: acme,
            name: '  Launch   crew ',
            memberIds: [dev.id, designer.id],
          })
          .expect(201)
      ).body;
      group = view._id;
      expect(view).toMatchObject({
        type: 'GROUP',
        name: 'Launch crew',
        canSend: true,
      });
      expect(view.members.map((m: { _id: string }) => m._id).sort()).toEqual(
        [dev.id, designer.id].sort(),
      );
      expect((await announced)?.conversationId).toBe(group);

      // In the inbox before the first message.
      const designerInbox = (
        await ctx
          .as(designer)
          .get(`/chat/conversations?workspaceId=${acme}`)
          .expect(200)
      ).body.items;
      expect(designerInbox.map((c: { _id: string }) => c._id)).toContain(group);

      const toDev = next<{ message: { body: string } }>(
        devSocket,
        'chat:message',
      );
      const toDesigner = next<{ message: { body: string } }>(
        designerSocket,
        'chat:message',
      );
      await ctx
        .as(owner)
        .post(`/chat/conversations/${group}/messages`)
        .send({ body: 'Kickoff at 10' })
        .expect(201);
      expect((await toDev)?.message.body).toBe('Kickoff at 10');
      expect((await toDesigner)?.message.body).toBe('Kickoff at 10');

      // "Read" only once everyone else has read it.
      const read = (user: TestUser) =>
        ctx
          .as(user)
          .post(`/chat/conversations/${group}/read`)
          .send({ seq: 1 })
          .expect(200);
      const ownerView = () =>
        ctx.as(owner).get(`/chat/conversations/${group}`).expect(200);
      await read(dev);
      expect((await ownerView()).body.peerLastReadSeq).toBe(0);
      await read(designer);
      expect((await ownerView()).body.peerLastReadSeq).toBe(1);

      // Outsiders can't see it.
      await ctx.as(outsider).get(`/chat/conversations/${group}`).expect(404);
    });
  });

  describe('revoked access', () => {
    it('removed members lose the conversation; the other side keeps read-only history', async () => {
      await ctx
        .as(owner)
        .delete(`/workspaces/${acme}/members/${dev.id}`)
        .expect(204);

      await ctx.as(dev).get(`/chat/conversations/${conversation}`).expect(404);
      await ctx
        .as(dev)
        .get(`/chat/conversations/${conversation}/messages`)
        .expect(404);
      // Acme chats (DM and group) are gone; chats in other workspaces stay.
      const inbox = (await ctx.as(dev).get('/chat/conversations').expect(200))
        .body.items as Array<{ workspace: { _id: string } }>;
      expect(inbox.length).toBeGreaterThan(0);
      expect(inbox.some((c) => c.workspace._id === acme)).toBe(false);
      expect(
        (
          await ctx
            .as(dev)
            .get(`/chat/conversations?workspaceId=${acme}`)
            .expect(200)
        ).body.items,
      ).toEqual([]);
      expect(
        (
          await ctx
            .as(dev)
            .get(`/chat/unread-count?workspaceId=${acme}`)
            .expect(200)
        ).body.count,
      ).toBe(0);

      const view = (
        await ctx
          .as(owner)
          .get(`/chat/conversations/${conversation}`)
          .expect(200)
      ).body;
      expect(view.canSend).toBe(false);
      await send(owner, 'Are you there?').expect(403);
      await ctx
        .as(owner)
        .get(`/chat/conversations/${conversation}/messages`)
        .expect(200);
    });
  });
});
