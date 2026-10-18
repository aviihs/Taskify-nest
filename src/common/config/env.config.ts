import * as dotenv from 'dotenv';

dotenv.config();

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT) || 3000,
  mongoUri: process.env.MONGO_URI,
  jwtSecret: process.env.JWT_SECRET,
  /** Comma-separated list of allowed CORS origins. Empty = reflect request origin. */
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  /** Public URL of the web app, used to build links in emails. */
  appUrl: process.env.APP_URL ?? 'https://taskify.app',
  uploadDir: process.env.UPLOAD_DIR ?? './uploads',
  /**
   * Firebase service account for push notifications: a path to the JSON key
   * file, or the JSON itself. Unset = push disabled.
   */
  firebaseServiceAccount: process.env.FIREBASE_SERVICE_ACCOUNT ?? '',
};

const REQUIRED_ENV = ['MONGO_URI', 'JWT_SECRET'] as const;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Host names in a MongoDB connection string; credentials and options are ignored. */
export function mongoHosts(uri: string): string[] {
  const rest = uri.trim().replace(/^mongodb(\+srv)?:\/\//i, '');
  const authority = rest.split(/[/?]/)[0];
  const hosts = authority.slice(authority.lastIndexOf('@') + 1);
  return hosts
    .split(',')
    .map((host) => host.trim().replace(/:\d+$/, '').toLowerCase())
    .filter(Boolean);
}

/** True when every host in the connection string is this machine. */
export function isLocalMongoUri(uri: string): boolean {
  const hosts = mongoHosts(uri);
  return hosts.length > 0 && hosts.every((host) => LOCAL_HOSTS.has(host));
}

/**
 * Why this process must not start, or null when it may: a development or test
 * process pointed at a remote database would read and write real data. Set
 * ALLOW_REMOTE_DB=true to say that is intended (for example a shared staging
 * database). Production is never blocked. Only host names are mentioned,
 * never credentials.
 */
export function remoteDatabaseRefusal(
  nodeEnv: string | undefined,
  mongoUri: string | undefined,
  allowRemote: string | undefined,
): string | null {
  if (nodeEnv === 'production' || allowRemote === 'true') return null;
  if (!mongoUri || isLocalMongoUri(mongoUri)) return null;
  return (
    `MONGO_URI points at a remote database (${mongoHosts(mongoUri).join(
      ', ',
    )}) ` +
    `but NODE_ENV is "${nodeEnv ?? 'development'}". Use a local MongoDB for ` +
    'development (see .env.example), or set ALLOW_REMOTE_DB=true if a shared ' +
    'remote database is really intended.'
  );
}

/** Fails fast at boot instead of failing on the first request. */
export function assertRequiredEnv(): void {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }
  const refusal = remoteDatabaseRefusal(
    process.env.NODE_ENV,
    process.env.MONGO_URI,
    process.env.ALLOW_REMOTE_DB,
  );
  if (refusal) throw new Error(refusal);
}
