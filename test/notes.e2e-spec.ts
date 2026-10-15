import { NoteReminderScheduler } from '../src/notes/note-reminder.scheduler';
import { createTestApp, TestContext, TestUser } from './utils/test-app';

const settle = () => new Promise((r) => setTimeout(r, 50));
const MINUTE = 60_000;

describe('Notes & reminders (e2e)', () => {
  let ctx: TestContext;
  let me: TestUser;
  let other: TestUser;

  beforeAll(async () => {
    ctx = await createTestApp();
    [me, other] = await Promise.all(['me', 'other'].map((n) => ctx.signUp(n)));
  });
  afterAll(() => ctx.close());

  const inFuture = (minutes: number) =>
    new Date(Date.now() + minutes * MINUTE).toISOString();

  it('validates notes', async () => {
    await ctx.as(me).post('/notes').send({ title: '   ' }).expect(400);
    await ctx
      .as(me)
      .post('/notes')
      .send({ title: 'x'.repeat(121) })
      .expect(400);
    await ctx
      .as(me)
      .post('/notes')
      .send({ title: 'Late', remindAt: inFuture(-60) })
      .expect(400);
    await ctx
      .as(me)
      .post('/notes')
      .send({ title: 'Bad date', remindAt: 'tomorrow-ish' })
      .expect(400);
  });

  it('keeps notes private and lists upcoming reminders first', async () => {
    const plain = (
      await ctx
        .as(me)
        .post('/notes')
        .send({ title: '  Groceries ', description: 'Milk, eggs' })
        .expect(201)
    ).body;
    expect(plain).toMatchObject({
      title: 'Groceries',
      description: 'Milk, eggs',
      remindAt: null,
    });
    const later = (
      await ctx
        .as(me)
        .post('/notes')
        .send({ title: 'Later', remindAt: inFuture(120) })
        .expect(201)
    ).body;
    const soon = (
      await ctx
        .as(me)
        .post('/notes')
        .send({ title: 'Soon', remindAt: inFuture(30) })
        .expect(201)
    ).body;

    const titles = async (scope: string) =>
      (await ctx.as(me).get(`/notes?scope=${scope}`).expect(200)).body.map(
        (n: { title: string }) => n.title,
      );
    expect(await titles('upcoming')).toEqual(['Soon', 'Later']);
    expect(await titles('all')).toEqual(['Soon', 'Later', 'Groceries']);

    // Someone else sees nothing and can't touch them.
    expect((await ctx.as(other).get('/notes').expect(200)).body).toEqual([]);
    await ctx
      .as(other)
      .patch(`/notes/${soon._id}`)
      .send({ title: 'Mine now' })
      .expect(404);
    await ctx.as(other).delete(`/notes/${later._id}`).expect(404);

    await ctx.as(me).delete(`/notes/${plain._id}`).expect(204);
    expect(await titles('all')).toEqual(['Soon', 'Later']);
  });

  it('reminds once at the time, and again after rescheduling', async () => {
    const note = (
      await ctx
        .as(me)
        .post('/notes')
        .send({ title: 'Pay rent', remindAt: inFuture(5) })
        .expect(201)
    ).body;
    const scheduler = ctx.app.get(NoteReminderScheduler);
    const reminders = async () =>
      (await ctx.as(me).get('/notifications').expect(200)).body.items.filter(
        (n: { type: string; entityId: string }) =>
          n.type === 'NOTE_REMINDER' && n.entityId === note._id,
      );

    // Not yet due.
    await scheduler.sendDueReminders(new Date());
    expect(await reminders()).toHaveLength(0);

    const at = new Date(Date.now() + 6 * MINUTE);
    expect(await scheduler.sendDueReminders(at)).toBeGreaterThanOrEqual(1);
    await scheduler.sendDueReminders(at); // never twice
    await settle();
    const sent = await reminders();
    expect(sent).toHaveLength(1);
    expect(sent[0].message).toBe('Reminder: Pay rent');
    // Only the owner is reminded.
    const othersInbox = (await ctx.as(other).get('/notifications').expect(200))
      .body.items;
    expect(othersInbox).toEqual([]);

    // A new time gets a new reminder; editing the text alone doesn't.
    await ctx
      .as(me)
      .patch(`/notes/${note._id}`)
      .send({ remindAt: inFuture(10) })
      .expect(200);
    await ctx
      .as(me)
      .patch(`/notes/${note._id}`)
      .send({ description: 'Before the 1st' })
      .expect(200);
    await scheduler.sendDueReminders(new Date(Date.now() + 11 * MINUTE));
    expect(await reminders()).toHaveLength(2);

    // Clearing the reminder.
    const cleared = (
      await ctx
        .as(me)
        .patch(`/notes/${note._id}`)
        .send({ remindAt: null })
        .expect(200)
    ).body;
    expect(cleared.remindAt).toBeNull();
  });
});
