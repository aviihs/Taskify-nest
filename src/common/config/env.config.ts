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
};

const REQUIRED_ENV = ['MONGO_URI', 'JWT_SECRET'] as const;

/** Fails fast at boot instead of failing on the first request. */
export function assertRequiredEnv(): void {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }
}
