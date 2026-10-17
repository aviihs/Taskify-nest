/**
 * QA helper for the app's integration tests (docs: taskify_app/docs/qa/qa-test-plan.md).
 *
 * Serves the current email-verification or password-reset OTP of a local QA
 * account, so a test can complete sign-up and reset without reading email:
 *
 *   GET http://127.0.0.1:3999/otp?email=<email>&kind=verify|reset → { otp }
 *
 * Refuses any database that isn't on this machine, and only listens on
 * 127.0.0.1. Never point it at staging or production.
 */
import { createServer } from 'http';
import * as mongoose from 'mongoose';

const PORT = Number(process.env.QA_OTP_PORT ?? 3999);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function assertLocal(uri: string): void {
  // mongodb://host:port,host2/db?… → every host must be local.
  const hosts = uri
    .replace(/^mongodb(\+srv)?:\/\//, '')
    .replace(/^[^@]*@/, '')
    .split('/')[0]
    .split(',')
    .map((h) => h.replace(/:\d+$/, '').replace(/^\[|\]$/g, ''));
  if (
    uri.startsWith('mongodb+srv:') ||
    !hosts.every((h) => LOCAL_HOSTS.has(h))
  ) {
    throw new Error(
      'Refusing to serve OTPs: MONGO_URI is not a local database',
    );
  }
}

async function main(): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is not set');
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run with NODE_ENV=production');
  }
  assertLocal(uri);
  const connection = (await mongoose.connect(uri)).connection;
  console.log(
    `QA OTP server: database ${connection.name} on ${connection.host}`,
  );

  createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
    const email = url.searchParams.get('email')?.trim().toLowerCase();
    const field =
      url.searchParams.get('kind') === 'reset'
        ? 'passwordResetOtp'
        : 'emailOtp';
    if (url.pathname !== '/otp' || !email) {
      res.writeHead(404).end();
      return;
    }
    const user = await connection
      .collection('users')
      .findOne({ email }, { projection: { [field]: 1 } });
    const otp = user?.[field] ?? null;
    res
      .writeHead(otp ? 200 : 404, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ otp }));
  }).listen(PORT, '127.0.0.1');
  console.log(`Listening on http://127.0.0.1:${PORT}/otp`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
