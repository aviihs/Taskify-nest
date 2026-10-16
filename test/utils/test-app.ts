import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Connection } from 'mongoose';
import * as request from 'supertest';

export interface SentEmail {
  to: string;
  subject: string;
  text: string;
}

/** Captures outgoing email so tests can read OTPs and invitations. */
export class FakeEmailService {
  readonly sent: SentEmail[] = [];
  readonly isConfigured = true;

  async sendMail(to: string, subject: string, text: string): Promise<void> {
    this.sent.push({ to, subject, text });
  }

  lastOtpFor(email: string): string {
    const mail = [...this.sent].reverse().find((m) => m.to === email);
    const otp = mail?.text.match(/\b(\d{6})\b/)?.[1];
    if (!otp) throw new Error(`No OTP email sent to ${email}`);
    return otp;
  }
}

export interface TestUser {
  id: string;
  email: string;
  userName: string;
  token: string;
}

export interface TestContext {
  app: INestApplication;
  emails: FakeEmailService;
  /** Authenticated HTTP client for a user. */
  as(user: TestUser): AuthedClient;
  http(): request.SuperTest<request.Test>;
  signUp(name?: string): Promise<TestUser>;
  close(): Promise<void>;
}

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
export type AuthedClient = Record<Method, (url: string) => request.Test>;

export interface TestAppOptions {
  /** Provider overrides, e.g. replacing an external API adapter with a fake. */
  overrides?: Array<
    | [unknown, unknown]
    | (() => Promise<[unknown, unknown]> | [unknown, unknown])
  >;
}

/**
 * Boots the real AppModule against a fresh in-memory database.
 * Imports are deferred so the per-file MONGO_URI is set before config loads.
 */
export async function createTestApp({
  overrides = [],
}: TestAppOptions = {}): Promise<TestContext> {
  const uri = new URL(process.env.TEST_MONGO_BASE_URI);
  uri.pathname = `/taskify-${randomUUID()}`;
  process.env.MONGO_URI = uri.toString();

  const { AppModule } = await import('../../src/app.module');
  const { configureApp } = await import('../../src/app.setup');
  const { EmailService } = await import('../../src/common/email/email.service');
  const { AuthService } = await import('../../src/auth/auth.service');

  const emails = new FakeEmailService();
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EmailService)
    .useValue(emails);
  for (const override of overrides) {
    const [token, value] =
      typeof override === 'function' ? await override() : override;
    builder.overrideProvider(token).useValue(value);
  }
  const moduleRef = await builder.compile();

  const app = configureApp(moduleRef.createNestApplication());
  await app.init();
  // Collections and indexes must exist before the first transaction uses them.
  const connection = moduleRef.get<Connection>(getConnectionToken());
  await Promise.all(Object.values(connection.models).map((m) => m.init()));
  const auth = moduleRef.get(AuthService);

  const http = () => request(app.getHttpServer());

  return {
    app,
    emails,
    http,
    as: (user) => {
      const withAuth = (req: request.Test) =>
        req.set('Authorization', `Bearer ${user.token}`);
      return {
        get: (url) => withAuth(http().get(url)),
        post: (url) => withAuth(http().post(url)),
        patch: (url) => withAuth(http().patch(url)),
        put: (url) => withAuth(http().put(url)),
        delete: (url) => withAuth(http().delete(url)),
      };
    },
    // Uses the real register + verify flow through the service layer
    // (bypassing HTTP rate limits so suites can create many users).
    signUp: async (name = 'user') => {
      const suffix = randomUUID().slice(0, 8);
      const email = `${name}.${suffix}@taskify.test`;
      const userName = `${name}_${suffix}`;
      await auth.register({
        firstName: name,
        lastName: 'Tester',
        email,
        userName,
        password: 'Password@123',
      });
      const verified = await auth.verifyEmail({
        email,
        otp: emails.lastOtpFor(email),
      });
      return {
        id: String(verified.user._id),
        email,
        userName,
        token: verified.accessToken,
      };
    },
    close: () => app.close(),
  };
}

/**
 * Retries [check] until it passes or [timeoutMs] runs out, then rethrows its
 * last failure. For effects of async event listeners (notifications,
 * activity), which land after the HTTP response that triggered them.
 */
export async function eventually<T>(
  check: () => Promise<T>,
  timeoutMs = 3000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await check();
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((r) => setTimeout(r, 25));
    }
  }
}
