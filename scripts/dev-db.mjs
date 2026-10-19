// Starts the local MongoDB that `start:dev` needs, if it is not running yet.
// The API uses transactions, so MongoDB must run as a replica set; a plain
// `brew services` mongod is not enough. Data lives in ./.mongo-dev.
//
//   node scripts/dev-db.mjs          start (and initialise) the database
//   node scripts/dev-db.mjs --stop   shut it down
//
// Skips everything when MONGO_URI points somewhere other than this machine
// (for example Atlas). Set MONGOD_BIN to use a specific mongod binary.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { MongoClient } from "mongodb";

const ROOT = resolve(import.meta.dirname, "..");
const DATA_DIRECTORY = join(ROOT, ".mongo-dev");
const REPLICA_SET = "rs0";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

if (existsSync(join(ROOT, ".env"))) process.loadEnvFile(join(ROOT, ".env"));

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
  console.error("dev-db: MONGO_URI is not set in .env");
  process.exit(1);
}
const { hostname, port: uriPort } = new URL(mongoUri);
if (!LOCAL_HOSTS.has(hostname)) {
  console.log(`dev-db: MONGO_URI points to ${hostname}; nothing to start.`);
  process.exit(0);
}
const port = Number(uriPort) || 27017;
const host = `127.0.0.1:${port}`;
const adminUri = `mongodb://${host}/admin?directConnection=true`;

async function withClient(callback) {
  const client = new MongoClient(adminUri, { serverSelectionTimeoutMS: 1500 });
  try {
    await client.connect();
    return await callback(client.db("admin"));
  } finally {
    await client.close().catch(() => undefined);
  }
}

const isRunning = () =>
  withClient(admin => admin.command({ ping: 1 })).then(
    () => true,
    () => false
  );

function findMongod() {
  if (process.env.MONGOD_BIN) return process.env.MONGOD_BIN;
  const onPath = spawnSync("which", ["mongod"], { encoding: "utf8" });
  if (onPath.status === 0) return onPath.stdout.trim();
  // The binary mongodb-memory-server downloads for the tests.
  const cache = join(ROOT, "node_modules/.cache/mongodb-memory-server");
  const cached = existsSync(cache)
    ? readdirSync(cache).find(name => name.startsWith("mongod-"))
    : undefined;
  if (cached) return join(cache, cached);
  console.error(
    "dev-db: mongod not found. Install it (brew install mongodb-community) or set MONGOD_BIN."
  );
  process.exit(1);
}

async function waitFor(check, what, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(done => setTimeout(done, 500));
  }
  throw new Error(`dev-db: timed out waiting for ${what}`);
}

async function ensureReplicaSet() {
  await withClient(async admin => {
    try {
      await admin.command({ replSetGetStatus: 1 });
    } catch (error) {
      // 94 NotYetInitialized: a fresh data directory.
      if (error.code === 94) {
        await admin.command({
          replSetInitiate: { _id: REPLICA_SET, members: [{ _id: 0, host }] },
        });
        console.log(`dev-db: initialised replica set ${REPLICA_SET}`);
      } else if (error.code === 76) {
        // 76 NoReplicationEnabled: something else is using this port.
        throw new Error(
          `dev-db: the mongod on port ${port} is not a replica set. Stop it, or point MONGO_URI at another port.`
        );
      } else {
        throw error;
      }
    }
  });
  await waitFor(
    () =>
      withClient(admin => admin.command({ hello: 1 })).then(
        hello => hello.isWritablePrimary === true,
        () => false
      ),
    "the replica set to elect a primary"
  );
}

async function stop() {
  if (!(await isRunning())) {
    console.log(`dev-db: nothing running on port ${port}`);
    return;
  }
  // The server closes the connection while shutting down; that is expected.
  await withClient(admin => admin.command({ shutdown: 1 })).catch(
    () => undefined
  );
  console.log(`dev-db: stopped MongoDB on port ${port}`);
}

async function start() {
  if (await isRunning()) {
    await ensureReplicaSet();
    console.log(`dev-db: MongoDB already running on port ${port}`);
    return;
  }
  mkdirSync(DATA_DIRECTORY, { recursive: true });
  const result = spawnSync(
    findMongod(),
    [
      "--dbpath",
      DATA_DIRECTORY,
      "--port",
      String(port),
      "--bind_ip",
      "127.0.0.1",
      "--replSet",
      REPLICA_SET,
      "--fork",
      "--logpath",
      join(DATA_DIRECTORY, "mongod.log"),
    ],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    console.error(result.stdout, result.stderr);
    console.error(
      `dev-db: mongod failed to start; see ${join(DATA_DIRECTORY, "mongod.log")}`
    );
    process.exit(1);
  }
  await waitFor(isRunning, "mongod to accept connections");
  await ensureReplicaSet();
  console.log(`dev-db: MongoDB running on port ${port} (data in .mongo-dev)`);
}

try {
  await (process.argv.includes("--stop") ? stop() : start());
} catch (error) {
  console.error(error.message ?? error);
  process.exit(1);
}
