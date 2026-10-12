import { existsSync } from 'fs';
import * as mongoose from 'mongoose';
import { join } from 'path';
import { runIntegrityChecks } from './integrity/integrity-checks';
import { resetAndSeed } from './seed/dev-seed';

/**
 * DESTRUCTIVE development reset: drops every collection and loads the seed.
 * Never run automatically. CLI entry:
 *
 *   ALLOW_DB_RESET=true npm run db:reset-dev -- \
 *     --confirm <host>/<database> --backup <mongodump output dir>
 *
 * Refuses unless NODE_ENV is not production, ALLOW_DB_RESET=true, the
 * confirmation names the database actually connected to, and (when the
 * database holds any documents) the backup directory has a dump of every
 * non-empty collection. Prints host and database name, never the URI.
 */
export interface ResetGuardInput {
  nodeEnv: string | undefined;
  allowReset: string | undefined;
  confirm: string | undefined;
  backupDir: string | undefined;
  target: { host: string; database: string };
  nonEmptyCollections: string[];
  fileExists?: (path: string) => boolean;
}

/** Returns the reasons the reset must not run (empty = allowed). */
export function resetRefusals({
  nodeEnv,
  allowReset,
  confirm,
  backupDir,
  target,
  nonEmptyCollections,
  fileExists = existsSync,
}: ResetGuardInput): string[] {
  const refusals: string[] = [];
  if (nodeEnv === 'production') refusals.push('NODE_ENV is production');
  if (allowReset !== 'true') refusals.push('ALLOW_DB_RESET=true is not set');
  const expected = `${target.host}/${target.database}`;
  if (confirm !== expected) {
    refusals.push(`--confirm must be exactly "${expected}"`);
  }
  if (nonEmptyCollections.length) {
    if (!backupDir) {
      refusals.push(
        '--backup <mongodump dir> is required: the database has data',
      );
    } else {
      const missing = nonEmptyCollections.filter(
        (c) =>
          !fileExists(join(backupDir, target.database, `${c}.bson`)) &&
          !fileExists(join(backupDir, target.database, `${c}.bson.gz`)),
      );
      if (missing.length) {
        refusals.push(
          `backup in ${backupDir} has no dump of: ${missing.join(', ')}`,
        );
      }
    }
  }
  return refusals;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) throw new Error('MONGO_URI is not set');
  const connection = (await mongoose.connect(mongoUri)).connection;
  try {
    const target = { host: connection.host, database: connection.name };
    console.log(`Target: host ${target.host}, database ${target.database}`);

    const nonEmptyCollections: string[] = [];
    for (const { name } of await connection.db
      .listCollections({}, { nameOnly: true })
      .toArray()) {
      if (
        !name.startsWith('system.') &&
        (await connection.db.collection(name).estimatedDocumentCount()) > 0
      ) {
        nonEmptyCollections.push(name);
      }
    }

    const refusals = resetRefusals({
      nodeEnv: process.env.NODE_ENV,
      allowReset: process.env.ALLOW_DB_RESET,
      confirm: arg('--confirm'),
      backupDir: arg('--backup'),
      target,
      nonEmptyCollections,
    });
    if (refusals.length) {
      console.error('Refusing to reset:');
      refusals.forEach((r) => console.error(`  - ${r}`));
      process.exitCode = 1;
      return;
    }

    const { collections } = await resetAndSeed(connection);
    console.log('Reset complete. Seeded documents:');
    for (const [name, count] of Object.entries(collections)) {
      console.log(`  ${name.padEnd(22)} ${count}`);
    }

    const { findings } = await runIntegrityChecks(connection.db);
    const problems = findings.filter((f) => f.severity !== 'info');
    if (problems.length) {
      console.error('Seed failed the integrity check:', problems);
      process.exitCode = 1;
    }
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Reset failed', error);
    process.exit(2);
  });
}
