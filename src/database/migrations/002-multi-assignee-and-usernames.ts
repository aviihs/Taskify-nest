import { Db, Migration } from './migration';

const USERNAME_MAX = 30;

/**
 * - Tasks: single `assignee` becomes the `assignees` array.
 * - Users: usernames become lowercase so they are unique regardless of case.
 *   An account whose lowercased name is already taken gets a numeric suffix
 *   (`shiva_2`); accounts already in lowercase keep their name.
 * Idempotent: only tasks still holding `assignee` and non-lowercase usernames are touched;
 * `assignees` already written by the app is never overwritten.
 */
export const multiAssigneeAndUsernamesMigration: Migration = {
  id: '002-multi-assignee-and-usernames',
  async up(db: Db) {
    const tasks = db.collection('tasks');
    // Tasks edited by new code before this ran already have `assignees`; keep them.
    await tasks.updateMany(
      { assignee: { $exists: true }, assignees: { $exists: false } },
      [
        {
          $set: {
            assignees: {
              $cond: [
                { $eq: [{ $ifNull: ['$assignee', null] }, null] },
                [],
                ['$assignee'],
              ],
            },
          },
        },
        { $unset: 'assignee' },
      ],
    );
    await tasks.updateMany(
      { assignee: { $exists: true } },
      { $unset: { assignee: '' } },
    );
    await tasks.updateMany(
      { assignees: { $exists: false } },
      { $set: { assignees: [] } },
    );
    await tasks.dropIndex('assignee_1_deletedAt_1_status_1_dueDate_1').catch(
      () => undefined, // already gone, or never built
    );

    const users = db.collection<{ userName?: string }>('users');
    const all = await users
      .find({}, { projection: { userName: 1 } })
      .sort({ createdAt: 1, _id: 1 })
      .toArray();
    const isNormal = (name: string) => name === name.trim().toLowerCase();
    // Names already in lowercase win; they can never clash with each other
    // because the old unique index was exact-match.
    const taken = new Set(
      all.map((u) => u.userName ?? '').filter((n) => n && isNormal(n)),
    );

    for (const user of all) {
      const current = user.userName ?? '';
      if (!current || isNormal(current)) continue;
      const base = current.trim().toLowerCase();
      let candidate = base;
      for (let n = 2; taken.has(candidate); n++) {
        const suffix = `_${n}`;
        candidate = base.slice(0, USERNAME_MAX - suffix.length) + suffix;
      }
      taken.add(candidate);
      await users.updateOne(
        { _id: user._id },
        { $set: { userName: candidate } },
      );
    }
  },
};
