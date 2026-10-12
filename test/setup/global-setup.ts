import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { tmpdir } from 'os';
import { join } from 'path';

declare global {
  // eslint-disable-next-line no-var
  var __MONGOD__: MongoMemoryReplSet;
}

export default async function globalSetup(): Promise<void> {
  // A replica set (not a standalone server): services use transactions.
  const mongod = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  globalThis.__MONGOD__ = mongod;
  // Inherited by test workers; each test file appends its own database name.
  process.env.TEST_MONGO_BASE_URI = mongod.getUri();
  process.env.JWT_SECRET = 'test-secret';
  process.env.NODE_ENV = 'test';
  process.env.UPLOAD_DIR = join(tmpdir(), 'taskify-test-uploads');
}
