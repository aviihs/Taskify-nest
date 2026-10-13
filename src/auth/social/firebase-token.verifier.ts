import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { getFirebaseApp } from '../../common/firebase/firebase-app';
import { isSocialProvider, SocialProvider } from './social-providers';

/** The verified facts Taskify uses from a Firebase ID token. */
export interface FirebaseIdentity {
  uid: string;
  provider: SocialProvider;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

/** Verifies Firebase ID tokens server-side. Replaced by a fake in tests. */
@Injectable()
export class FirebaseTokenVerifier {
  private readonly logger = new Logger(FirebaseTokenVerifier.name);

  async verify(idToken: string): Promise<FirebaseIdentity> {
    let app: ReturnType<typeof getFirebaseApp>;
    try {
      app = getFirebaseApp();
    } catch (error) {
      this.logger.error(
        'Invalid FIREBASE_SERVICE_ACCOUNT',
        error instanceof Error ? error.message : String(error),
      );
      app = null;
    }
    if (!app) {
      throw new ServiceUnavailableException('Social sign-in is not available.');
    }

    // Loaded on first use: keeps firebase-admin/auth (ESM deps) out of boot.
    const { getAuth } = await import('firebase-admin/auth');
    let decoded: DecodedIdToken;
    try {
      // checkRevoked: a disabled Firebase user or revoked session is rejected.
      decoded = await getAuth(app).verifyIdToken(idToken, true);
    } catch {
      throw new UnauthorizedException('Invalid or expired sign-in token.');
    }

    const provider = decoded.firebase?.sign_in_provider;
    if (!isSocialProvider(provider)) {
      throw new UnauthorizedException('Unsupported sign-in provider.');
    }
    return {
      uid: decoded.uid,
      provider,
      email: decoded.email?.trim().toLowerCase() || null,
      emailVerified: decoded.email_verified === true,
      name: typeof decoded.name === 'string' ? decoded.name : null,
      picture: decoded.picture ?? null,
    };
  }
}
