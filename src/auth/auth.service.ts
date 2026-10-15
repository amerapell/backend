import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { addMinutes, CLOCK, Clock } from '../common/clock';
import { randomToken, sha256 } from '../common/ids';
import { normalizeNigerianPhone } from '../common/phone';
import type { UserRow } from '../db/schema';
import { NotificationsService } from '../email/notifications.service';
import { CONTENT_REPOSITORY, ContentRepository } from '../content/content.repository';
import { CreditService } from '../credit/credit.service';
import { PASSWORD_HASHER, PasswordHasher } from './password-hasher';
import { TokenService } from './token.service';
import { USERS_REPOSITORY, UsersRepository } from './users.repository';
import { RegisterDto } from './auth.dto';
import { EmailVerificationService } from './email-verification.service';
import { GOOGLE_ID_TOKEN_VERIFIER, GoogleIdTokenVerifier } from './google-id-token.verifier';

export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  /** False until the customer confirms their email; credit and pre-account guest orders stay hidden until then. */
  emailVerified: boolean;
  creditBalanceKobo: number;
}

export interface AuthResult {
  accessToken: string;
  user: PublicUser;
  refresh: { token: string; expiresAt: Date };
}

@Injectable()
export class AuthService {
  /** Real hash of a throwaway password so unknown emails cost as much time as wrong passwords. */
  private dummyHash: Promise<string> | null = null;

  constructor(
    @Inject(USERS_REPOSITORY) private readonly users: UsersRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONTENT_REPOSITORY) private readonly content: ContentRepository,
    private readonly tokens: TokenService,
    private readonly credit: CreditService,
    private readonly notifications: NotificationsService,
    private readonly verification: EmailVerificationService,
    @Inject(GOOGLE_ID_TOKEN_VERIFIER) private readonly google: GoogleIdTokenVerifier,
  ) {}

  async publicUser(u: UserRow): Promise<PublicUser> {
    return {
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      phone: u.phone,
      emailVerified: !!u.emailVerifiedAt,
      // Credit is keyed by email: an account that has not proved it owns the address cannot see it.
      creditBalanceKobo: u.emailVerifiedAt ? await this.credit.balance(u.email) : 0,
    };
  }

  private async session(u: UserRow): Promise<AuthResult> {
    return { accessToken: this.tokens.signAccess(u), user: await this.publicUser(u), refresh: await this.tokens.issueRefresh(u.id) };
  }

  async register(dto: RegisterDto): Promise<AuthResult> {
    const email = dto.email.trim().toLowerCase();
    if (await this.users.findByEmail(email)) throw new ConflictException('An account with this email already exists');
    let phone: string | null = null;
    if (dto.phone) {
      phone = normalizeNigerianPhone(dto.phone);
      if (!phone) throw new BadRequestException('Enter a valid Nigerian phone number (080… or +234…)');
    }
    const user = await this.users.create({
      email,
      passwordHash: await this.hasher.hash(dto.password),
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
      phone,
      marketingConsent: dto.marketingConsent === true,
    });
    if (dto.marketingConsent === true) await this.content.subscribe(email, true, 'register');
    // Signed in straight away, but unverified until they click the link in this email.
    await this.verification.send(user);
    return this.session(user);
  }

  async validateCredentials(emailRaw: string, password: string): Promise<UserRow> {
    const user = await this.users.findByEmail(emailRaw);
    this.dummyHash ??= this.hasher.hash('timing-equaliser-not-a-password');
    const ok = await this.hasher.verify(password, user?.passwordHash ?? (await this.dummyHash));
    if (!user || !ok || user.deletedAt) throw new UnauthorizedException('Incorrect email or password');
    return user;
  }

  async login(email: string, password: string): Promise<AuthResult> {
    // Account created with Google (or whose unverified password was retired by a Google sign-in):
    // there is no password to check, so say how to get in instead of "incorrect password".
    const existing = await this.users.findByEmail(email);
    if (existing && !existing.deletedAt && isUnusablePasswordHash(existing.passwordHash)) {
      throw new UnauthorizedException(GOOGLE_ONLY_MESSAGE);
    }
    const user = await this.validateCredentials(email, password);
    // Only after the password is proven: the store's admin login is separate (it needs the 2-step code).
    if (user.role !== 'CUSTOMER') throw new UnauthorizedException(ADMIN_ACCOUNT_MESSAGE);
    return this.session(user);
  }

  async refresh(raw: string | undefined): Promise<{ accessToken: string; refresh: { token: string; expiresAt: Date } }> {
    if (!raw) throw new UnauthorizedException('No refresh token');
    const rotated = await this.tokens.rotate(raw);
    if (!rotated) throw new UnauthorizedException('Session expired — please sign in again');
    const user = await this.users.findById(rotated.userId);
    if (!user || user.deletedAt) throw new UnauthorizedException('Session expired — please sign in again');
    return { accessToken: this.tokens.signAccess(user), refresh: { token: rotated.token, expiresAt: rotated.expiresAt } };
  }

  async verifyEmail(token: string): Promise<PublicUser> {
    return this.publicUser(await this.verification.verify(token));
  }

  async resendVerification(userId: string): Promise<{ ok: true; sent: boolean }> {
    return { ok: true, sent: await this.verification.resend(userId) };
  }

  /**
   * Sign in with Google: the ID token proves the email, so the account is verified on the way in.
   * Existing account → linked (googleSub) and logged in; otherwise a CUSTOMER is created with no usable password.
   */
  async googleSignIn(credential: string): Promise<AuthResult> {
    if (!this.google.configured) throw new ServiceUnavailableException('Google sign-in is not configured');
    const identity = await this.google.verify(credential);
    if (!identity) throw new UnauthorizedException('Google sign-in failed — please try again');
    if (!identity.emailVerified) throw new UnauthorizedException('Your Google account email is not verified');

    let user = (await this.users.findByGoogleSub(identity.sub)) ?? (await this.users.findByEmail(identity.email));
    if (user) {
      if (user.deletedAt) throw new UnauthorizedException('This account has been deleted');
      if (user.role !== 'CUSTOMER') throw new UnauthorizedException(ADMIN_ACCOUNT_MESSAGE);
      if (user.googleSub && user.googleSub !== identity.sub) throw new ConflictException('This email is linked to a different Google account');
      const extra: { googleSub?: string; passwordHash?: string } = {};
      if (!user.googleSub) extra.googleSub = identity.sub;
      if (!user.emailVerifiedAt) {
        // Whoever set this password never proved they own the email — invalidate it (and its sessions)
        // so a squatter who registered first cannot ride on the Google owner's verification.
        extra.passwordHash = unusablePasswordHash();
        await this.users.revokeAllRefreshTokens(user.id, this.clock.now());
      }
      user = await this.verification.markVerified(user, extra);
    } else {
      user = await this.users.create({
        email: identity.email,
        passwordHash: unusablePasswordHash(),
        firstName: identity.givenName,
        lastName: identity.familyName,
        phone: null,
        marketingConsent: false,
        googleSub: identity.sub,
      });
      user = await this.verification.markVerified(user);
    }
    return this.session(user);
  }

  async logout(raw: string | undefined): Promise<void> {
    if (raw) await this.tokens.revoke(raw);
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user || user.deletedAt) return;
    const token = randomToken(32);
    await this.users.saveResetToken(user.id, sha256(token), addMinutes(this.clock.now(), 60));
    await this.notifications.passwordReset(user.email, user.firstName, token);
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const userId = await this.users.consumeResetToken(sha256(token), this.clock.now());
    if (!userId) throw new BadRequestException('This reset link is invalid or has expired');
    await this.users.update(userId, { passwordHash: await this.hasher.hash(password) });
    await this.users.revokeAllRefreshTokens(userId, this.clock.now());
  }
}

/** Not a bcrypt hash, so no password ever matches it; the user can set one via "Forgot password". */
const UNUSABLE_PREFIX = '!unusable:';
function unusablePasswordHash(): string {
  return `${UNUSABLE_PREFIX}${randomToken(24)}`;
}
function isUnusablePasswordHash(hash: string | null | undefined): boolean {
  return !hash || hash.startsWith(UNUSABLE_PREFIX);
}

export const GOOGLE_ONLY_MESSAGE =
  'This account signs in with Google. Use "Continue with Google", or choose "Forgot your password?" to set a password for it.';
export const ADMIN_ACCOUNT_MESSAGE =
  "This email belongs to the store's admin account. Sign in at /admin, or use a different email to shop.";
