import { workspaceModelMigration } from './001-workspace-model';
import { multiAssigneeAndUsernamesMigration } from './002-multi-assignee-and-usernames';
import { Db, Migration } from './migration';

/** Ordered list. Append only. */
export const MIGRATIONS: Migration[] = [
  workspaceModelMigration,
  multiAssigneeAndUsernamesMigration,
];

const LEDGER = '_migrations';

/** Runs pending migrations in order and records each one; safe to run on every deploy. */
export async function runMigrations(
  db: Db,
  log: (message: string) => void = console.log,
): Promise<string[]> {
  const ledger = db.collection<{ _id: string; appliedAt: Date }>(LEDGER);
  const applied = new Set((await ledger.find().toArray()).map((m) => m._id));
  const ran: string[] = [];

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    log(`Running migration ${migration.id}`);
    await migration.up(db);
    await ledger.insertOne({ _id: migration.id, appliedAt: new Date() });
    ran.push(migration.id);
  }
  log(
    ran.length ? `Applied ${ran.length} migration(s)` : 'No pending migrations',
  );
  return ran;
}
