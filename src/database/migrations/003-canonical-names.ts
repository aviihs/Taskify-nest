import { Db, Migration } from './migration';

/** Old Mongoose-pluralized names → canonical snake_case names (docs/DATA_MODEL.md §2). */
export const COLLECTION_RENAMES: Array<[from: string, to: string]> = [
  ['workspacemembers', 'workspace_members'],
  ['workspaceinvitations', 'workspace_invitations'],
  ['projectmembers', 'project_members'],
];

/**
 * Copies every document of `from` into `to` keeping its `_id`. Identical
 * copies are skipped, so a re-run is safe. A different document with the same
 * `_id`, or one that breaks a unique index, aborts before anything is dropped.
 */
async function mergeInto(db: Db, from: string, to: string): Promise<void> {
  const target = db.collection(to);
  for await (const doc of db.collection(from).find()) {
    const current = await target.findOne({ _id: doc._id });
    if (current) {
      if (JSON.stringify(current) !== JSON.stringify(doc)) {
        throw new Error(
          `Cannot merge ${from} into ${to}: document ${doc._id} differs in both; resolve it manually`,
        );
      }
      continue;
    }
    try {
      await target.insertOne(doc);
    } catch (error) {
      throw new Error(
        `Cannot merge ${from} into ${to}: document ${doc._id} conflicts (${
          (error as Error).message
        }); resolve it manually`,
      );
    }
  }
}

/**
 * - Renames three collections to the snake_case convention. Ids, documents
 *   and indexes move with the collection.
 * - Users: `isDeleted` → `deletedAt`; password reset OTP fields renamed to
 *   match the email OTP fields.
 * - Drops the unused `tasks {workspace, deletedAt, dueDate}` index.
 * Non-destructive and idempotent: when both names exist, documents are
 * copied with their ids and the old collection is dropped only after every
 * document is present in the new one.
 */
export const canonicalNamesMigration: Migration = {
  id: '003-canonical-names',
  async up(db: Db) {
    const existing = new Set(
      (await db.listCollections({}, { nameOnly: true }).toArray()).map(
        (c) => c.name,
      ),
    );
    for (const [from, to] of COLLECTION_RENAMES) {
      if (!existing.has(from)) continue;
      if (!existing.has(to)) {
        await db.collection(from).rename(to);
        continue;
      }
      // The new app already wrote to `to` (e.g. it booted before this ran).
      await mergeInto(db, from, to);
      await db.collection(from).drop();
    }

    const users = db.collection('users');
    await users.updateMany({ isDeleted: { $exists: true } }, [
      {
        $set: {
          deletedAt: {
            $cond: [
              { $eq: ['$isDeleted', true] },
              { $ifNull: ['$updatedAt', '$$NOW'] },
              null,
            ],
          },
        },
      },
      { $unset: 'isDeleted' },
    ]);
    await users.updateMany(
      { deletedAt: { $exists: false } },
      { $set: { deletedAt: null } },
    );
    await users.updateMany(
      {
        $or: [
          { passwordResetToken: { $exists: true } },
          { passwordResetExpires: { $exists: true } },
        ],
      },
      {
        $rename: {
          passwordResetToken: 'passwordResetOtp',
          passwordResetExpires: 'passwordResetOtpExpiresAt',
        },
      },
    );

    if (existing.has('tasks')) {
      await db
        .collection('tasks')
        .dropIndex('workspace_1_deletedAt_1_dueDate_1')
        .catch(() => undefined); // already gone, or never built
    }
  },
};
