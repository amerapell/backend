import { Injectable } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { AppConfig } from '../config/app-config';

export const GOOGLE_ID_TOKEN_VERIFIER = Symbol('GOOGLE_ID_TOKEN_VERIFIER');

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  givenName: string;
  familyName: string;
}

export interface GoogleIdTokenVerifier {
  /** False when GOOGLE_CLIENT_ID is not set. */
  readonly configured: boolean;
  /** Verifies signature, issuer, expiry and audience; null when the credential is not a valid Google ID token. */
  verify(credential: string): Promise<GoogleIdentity | null>;
}

@Injectable()
export class GoogleAuthLibraryVerifier implements GoogleIdTokenVerifier {
  private readonly client = new OAuth2Client();

  constructor(private readonly config: AppConfig) {}

  get configured(): boolean {
    return !!this.config.values.googleClientId;
  }

  async verify(credential: string): Promise<GoogleIdentity | null> {
    const audience = this.config.values.googleClientId;
    if (!audience) return null;
    try {
      const ticket = await this.client.verifyIdToken({ idToken: credential, audience });
      const p = ticket.getPayload();
      if (!p?.sub || !p.email) return null;
      const [first = '', ...rest] = (p.name ?? '').trim().split(/\s+/);
      return {
        sub: p.sub,
        email: p.email.trim().toLowerCase(),
        emailVerified: p.email_verified === true,
        givenName: (p.given_name ?? first).trim(),
        familyName: (p.family_name ?? rest.join(' ')).trim(),
      };
    } catch {
      return null;
    }
  }
}
