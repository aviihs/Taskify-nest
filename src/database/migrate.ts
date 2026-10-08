import * as mongoose from 'mongoose';
import { assertRequiredEnv, env } from '../common/config/env.config';
import { runMigrations } from './migrations/run-migrations';

/** CLI entry: `pnpm migrate` (dev) or `node dist/database/migrate` (prod). */
async function main(): Promise<void> {
  assertRequiredEnv();
  const connection = await mongoose.connect(env.mongoUri);
  try {
    await runMigrations(connection.connection.db);
  } finally {
    await connection.disconnect();
  }
}

main().catch((error) => {
  console.error('Migration failed', error);
  process.exit(1);
});
