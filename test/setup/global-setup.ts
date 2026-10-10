import { MongoMemoryServer } from 'mongodb-memory-server';
import { tmpdir } from 'os';
import { join } from 'path';

declare global {
  // eslint-disable-next-line no-var
  var __MONGOD__: MongoMemoryServer;
}

export default async function globalSetup(): Promise<void> {
  const mongod = await MongoMemoryServer.create();
  globalThis.__MONGOD__ = mongod;
  // Inherited by test workers; each test file appends its own database name.
  process.env.TEST_MONGO_BASE_URI = mongod.getUri();
  process.env.JWT_SECRET = 'test-secret';
  process.env.NODE_ENV = 'test';
  process.env.UPLOAD_DIR = join(tmpdir(), 'taskify-test-uploads');
}
