// Jest 27's node environment doesn't expose the global Web Crypto object that
// Node 19+ provides, but @nestjs/schedule calls `crypto.randomUUID()` when it
// registers @Cron/@Interval jobs.
import { webcrypto } from 'crypto';

if (!(globalThis as any).crypto) {
  (globalThis as any).crypto = webcrypto;
}
