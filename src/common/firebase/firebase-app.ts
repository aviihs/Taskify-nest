import { readFileSync } from 'fs';
import {
  App,
  cert,
  getApps,
  initializeApp,
  ServiceAccount,
} from 'firebase-admin/app';
import { env } from '../config/env.config';

/**
 * The process-wide default Firebase Admin app, initialised from
 * FIREBASE_SERVICE_ACCOUNT (a JSON key file path or the JSON itself).
 * Reuses the app if another module (push) already created it.
 * Returns null when Firebase isn't configured. Throws on an invalid key.
 */
export function getFirebaseApp(): App | null {
  const existing = getApps()[0];
  if (existing) return existing;
  const raw = env.firebaseServiceAccount.trim();
  if (!raw) return null;
  const json = raw.startsWith('{') ? raw : readFileSync(raw, 'utf8');
  return initializeApp({
    credential: cert(JSON.parse(json) as ServiceAccount),
  });
}
