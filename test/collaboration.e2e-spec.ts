import { DueDateReminderScheduler } from '../src/notifications/due-date-reminder.scheduler';
import { createTestApp, TestContext, TestUser } from './utils/test-app';

const settle = () => new Promise((r) => setTimeout(r, 50)); // async event listeners

describe('Comments, notifications, attachments, activity & dashboard (e2e)', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let dev: TestUser; // MEMBER on the project
  let viewer: TestUser; // VIEWER on the project
  let outsider: TestUser;
  let acme: string;
  let project: string;
  let task: string;

  const join = async (user: TestUser, role: string) => {
    const inv = await ctx
      .as(owner)
      .post(`/workspaces/${acme}/invitations`)
      .send({ email: user.email, role })
      .expect(201);
    await ctx.as(user).post(`/invitations/${inv.body._id}/accept`).expect(201);
    await ctx
      .as(owner)
      .post(`/projects/${project}/members`)
      .send({ userId: user.id })
      .expect(201);
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    [owner, dev, viewer, outsider] = await Promise.all(
      ['owner', 'dev', 'viewer', 'outsider'].map((n) => ctx.signUp(n)),
    );
    acme = (
      await ctx.as(owner).post('/workspaces').send({ name: 'Acme' }).expect(201)
    ).body._id;
    project = (
      await ctx
        .as(owner)
        .post(`/workspaces/${acme}/projects`)
        .send({ name: 'Launch' })
        .expect(201)
    ).body._id;
    await join(dev, 'MEMBER');
    await join(viewer, 'VIEWER');
    task = (
      await ctx
        .as(owner)
        .post(`/projects/${project}/tasks`)
        .send({ title: 'Ship it', assigneeIds: [dev.id] })
        .expect(201)
    ).body._id;
  });
  afterAll(() => ctx.close());

  describe('notifications', () => {
    it('notifies the assignee and can only be read by its recipient', async () => {
      await settle();
      const list = await ctx.as(dev).get('/notifications').expect(200);
      const assigned = list.body.items.find((n) => n.type === 'TASK_ASSIGNED');
      expect(assigned).toMatchObject({
        message: 'You were assigned "Ship it"',
        link: `/tasks/${task}`,
      });

      expect(
        (await ctx.as(dev).get('/notifications/unread-count').expect(200)).body
          .count,
      ).toBeGreaterThan(0);
      await ctx
        .as(owner)
        .patch(`/notifications/${assigned._id}/read`)
        .expect(404);
      const read = await ctx
        .as(dev)
        .patch(`/notifications/${assigned._id}/read`)
        .expect(200);
      expect(read.body.readAt).toBeTruthy();
      await ctx.as(dev).patch('/notifications/read-all').expect(200);
      expect(
        (await ctx.as(dev).get('/notifications/unread-count').expect(200)).body
          .count,
      ).toBe(0);
    });

    it('notifies the creator when the status changes', async () => {
      await ctx
        .as(dev)
        .patch(`/tasks/${task}`)
        .send({ status: 'IN_REVIEW' })
        .expect(200);
      await settle();
      const list = await ctx
        .as(owner)
        .get('/notifications?unreadOnly=true')
        .expect(200);
      expect(list.body.items.map((n) => n.message)).toContain(
        '"Ship it" moved TODO → IN_REVIEW',
      );
    });

    it('sends due-soon reminders exactly once', async () => {
      const soon = new Date(Date.now() + 3 * 3_600_000).toISOString();
      await ctx
        .as(owner)
        .patch(`/tasks/${task}`)
        .send({ dueDate: soon })
        .expect(200);
      const scheduler = ctx.app.get(DueDateReminderScheduler);
      expect(await scheduler.sendDueSoonReminders()).toBe(1);
      expect(await scheduler.sendDueSoonReminders()).toBe(0);
      const list = await ctx.as(dev).get('/notifications').expect(200);
      expect(
        list.body.items.filter((n) => n.type === 'TASK_DUE_SOON'),
      ).toHaveLength(1);
    });
  });

  describe('comments', () => {
    let commentId: string;

    it('notify mentioned users and task watchers', async () => {
      const res = await ctx
        .as(viewer)
        .post(`/tasks/${task}/comments`)
        .send({
          content: `Looks great @${dev.userName}! cc @${outsider.userName}`,
        })
        .expect(201);
      commentId = res.body._id;
      // Outsiders cannot be mentioned into a task they cannot see.
      expect(res.body.mentions).toEqual([dev.id]);
      expect(res.body.author).toMatchObject({ _id: viewer.id });

      await settle();
      const devNotes = await ctx
        .as(dev)
        .get('/notifications?unreadOnly=true')
        .expect(200);
      expect(devNotes.body.items.map((n) => n.type)).toContain('MENTIONED');
      expect(devNotes.body.items.map((n) => n.type)).not.toContain(
        'COMMENT_ADDED',
      );
      const ownerNotes = await ctx
        .as(owner)
        .get('/notifications?unreadOnly=true')
        .expect(200);
      expect(ownerNotes.body.items.map((n) => n.type)).toContain(
        'COMMENT_ADDED',
      );
      const outsiderNotes = await ctx
        .as(outsider)
        .get('/notifications')
        .expect(200);
      expect(outsiderNotes.body.items).toHaveLength(0);
    });

    it('support one level of replies, listed with their thread', async () => {
      const reply = await ctx
        .as(dev)
        .post(`/tasks/${task}/comments`)
        .send({ content: 'Thanks!', parentCommentId: commentId })
        .expect(201);
      await ctx
        .as(dev)
        .post(`/tasks/${task}/comments`)
        .send({ content: 'Nested', parentCommentId: reply.body._id })
        .expect(400);

      const threads = await ctx
        .as(owner)
        .get(`/tasks/${task}/comments`)
        .expect(200);
      expect(threads.body.items).toHaveLength(1);
      expect(threads.body.items[0].replies.map((r) => r.content)).toEqual([
        'Thanks!',
      ]);
    });

    it('can be edited only by the author; moderators may delete', async () => {
      await ctx
        .as(dev)
        .patch(`/comments/${commentId}`)
        .send({ content: 'hijack' })
        .expect(403);
      const edited = await ctx
        .as(viewer)
        .patch(`/comments/${commentId}`)
        .send({ content: 'Edited' })
        .expect(200);
      expect(edited.body.editedAt).toBeTruthy();
      await ctx.as(outsider).delete(`/comments/${commentId}`).expect(404);
      await ctx.as(owner).delete(`/comments/${commentId}`).expect(204);
      const threads = await ctx
        .as(owner)
        .get(`/tasks/${task}/comments`)
        .expect(200);
      expect(threads.body.items).toHaveLength(0);
    });
  });

  describe('attachments', () => {
    it('upload, download and delete with access checks', async () => {
      const upload = await ctx
        .as(dev)
        .post(`/tasks/${task}/attachments`)
        .attach('file', Buffer.from('hello taskify'), {
          filename: '../../spec.txt',
          contentType: 'text/plain',
        })
        .expect(201);
      expect(upload.body).toMatchObject({
        fileName: 'spec.txt',
        size: 13,
        mimeType: 'text/plain',
      });
      expect(upload.body).not.toHaveProperty('storageKey');

      await ctx
        .as(dev)
        .post(`/tasks/${task}/attachments`)
        .attach('file', Buffer.from('MZ'), {
          filename: 'run.exe',
          contentType: 'application/x-msdownload',
        })
        .expect(400);
      await ctx
        .as(viewer)
        .post(`/tasks/${task}/attachments`)
        .attach('file', Buffer.from('x'), {
          filename: 'a.txt',
          contentType: 'text/plain',
        })
        .expect(403);

      const download = await ctx
        .as(viewer)
        .get(`/attachments/${upload.body._id}/download`)
        .expect(200);
      expect(download.text).toBe('hello taskify');
      expect(download.headers['content-disposition']).toContain(
        "filename*=UTF-8''spec.txt",
      );
      await ctx
        .as(outsider)
        .get(`/attachments/${upload.body._id}/download`)
        .expect(404);

      await ctx
        .as(viewer)
        .delete(`/attachments/${upload.body._id}`)
        .expect(403);
      await ctx.as(dev).delete(`/attachments/${upload.body._id}`).expect(204);
      await ctx
        .as(dev)
        .get(`/attachments/${upload.body._id}/download`)
        .expect(404);
    });
  });

  describe('activity', () => {
    it('records a workspace feed without leaking hidden projects', async () => {
      const hidden = (
        await ctx
          .as(owner)
          .post(`/workspaces/${acme}/projects`)
          .send({ name: 'Top secret' })
          .expect(201)
      ).body._id;
      await settle();

      const ownerFeed = await ctx
        .as(owner)
        .get(`/workspaces/${acme}/activity?limit=100`)
        .expect(200);
      expect(ownerFeed.body.items.some((a) => a.project === hidden)).toBe(true);
      const devFeed = await ctx
        .as(dev)
        .get(`/workspaces/${acme}/activity?limit=100`)
        .expect(200);
      expect(devFeed.body.items.some((a) => a.project === hidden)).toBe(false);
      expect(devFeed.body.items.map((a) => a.action)).toEqual(
        expect.arrayContaining([
          'task.created',
          'comment.created',
          'workspace.member.joined',
        ]),
      );
    });
  });

  describe('dashboard', () => {
    it('aggregates live task data', async () => {
      const yesterday = new Date(Date.now() - 86_400_000).toISOString();
      await ctx
        .as(owner)
        .post(`/projects/${project}/tasks`)
        .send({ title: 'Late', assigneeIds: [dev.id], dueDate: yesterday })
        .expect(201);
      await ctx
        .as(owner)
        .post(`/projects/${project}/tasks`)
        .send({ title: 'Done', status: 'DONE' })
        .expect(201);

      const res = await ctx
        .as(owner)
        .get(`/workspaces/${acme}/dashboard`)
        .expect(200);
      expect(res.body.summary).toMatchObject({
        total: 3,
        completed: 1,
        overdue: 1,
      });
      expect(res.body.byStatus).toMatchObject({
        DONE: 1,
        IN_REVIEW: 1,
        TODO: 1,
      });
      expect(res.body.projects.find((p) => p._id === project).progress).toEqual(
        {
          total: 3,
          completed: 1,
          percent: 33,
        },
      );
      expect(res.body.workload).toEqual([
        expect.objectContaining({
          user: expect.objectContaining({ _id: dev.id }),
          open: 2,
          overdue: 1,
        }),
      ]);
      await ctx.as(outsider).get(`/workspaces/${acme}/dashboard`).expect(404);
    });
  });

  describe('leaving a workspace', () => {
    it('revokes project access and unassigns open work', async () => {
      await ctx
        .as(owner)
        .delete(`/workspaces/${acme}/members/${dev.id}`)
        .expect(204);
      await settle();
      await ctx.as(dev).get(`/projects/${project}`).expect(404);
      const t = await ctx.as(owner).get(`/tasks/${task}`).expect(200);
      expect(t.body.assignees).toEqual([]);
      const mine = await ctx.as(dev).get('/users/me/tasks').expect(200);
      expect(mine.body.items).toHaveLength(0);
    });
  });
});
