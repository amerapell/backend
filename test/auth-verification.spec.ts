import { BadRequestException, ConflictException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createId } from '@paralleldrive/cuid2';
import { ADMIN_ACCOUNT_MESSAGE, AuthService, GOOGLE_ONLY_MESSAGE } from '../src/auth/auth.service';
import { EmailVerificationService, INVALID_VERIFICATION_LINK } from '../src/auth/email-verification.service';
import type { GoogleIdentity, GoogleIdTokenVerifier } from '../src/auth/google-id-token.verifier';
import type { PasswordHasher } from '../src/auth/password-hasher';
import type { TokenService } from '../src/auth/token.service';
import type { NewUser, UsersRepository } from '../src/auth/users.repository';
import type { ContentRepository } from '../src/content/content.repository';
import { CreditService } from '../src/credit/credit.service';
import type { UserRow } from '../src/db/schema';
import { NotificationsService } from '../src/email/notifications.service';
import { sha256 } from '../src/common/ids';
import { FakeClock, RecordingEmailSender, settingsService, testConfig } from './fakes';
import { InMemoryCreditRepository } from './fakes/repositories';

interface TokenRecord {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

class InMemoryUsersRepository implements UsersRepository {
  users: UserRow[] = [];
  verification: TokenRecord[] = [];
  revokedFor: string[] = [];
  constructor(private readonly clock: FakeClock) {}

  async findByEmail(email: string) {
    return this.users.find((u) => u.email === email.trim().toLowerCase()) ?? null;
  }
  async findById(id: string) {
    return this.users.find((u) => u.id === id) ?? null;
  }
  async findByGoogleSub(sub: string) {
    return this.users.find((u) => u.googleSub === sub) ?? null;
  }
  async create(n: NewUser) {
    const now = this.clock.now();
    const row: UserRow = {
      id: createId(),
      email: n.email.trim().toLowerCase(),
      passwordHash: n.passwordHash,
      firstName: n.firstName,
      lastName: n.lastName,
      phone: n.phone,
      role: n.role ?? 'CUSTOMER',
      marketingConsent: n.marketingConsent,
      totpSecret: null,
      totpEnabled: false,
      emailVerifiedAt: n.emailVerifiedAt ?? null,
      googleSub: n.googleSub ?? null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.users.push(row);
    return row;
  }
  async update(id: string, patch: Partial<UserRow>) {
    const u = this.users.find((x) => x.id === id);
    if (!u) return null;
    Object.assign(u, patch);
    return u;
  }
  async saveRefreshToken() {}
  async findActiveRefreshToken() {
    return null;
  }
  async revokeRefreshToken() {}
  async revokeAllRefreshTokens(userId: string) {
    this.revokedFor.push(userId);
  }
  reset: TokenRecord[] = [];
  async saveResetToken(userId: string, tokenHash: string, expiresAt: Date) {
    this.reset.push({ userId, tokenHash, expiresAt, usedAt: null, createdAt: this.clock.now() });
  }
  async consumeResetToken(tokenHash: string, now: Date) {
    const t = this.reset.find((v) => v.tokenHash === tokenHash && !v.usedAt && v.expiresAt > now);
    if (!t) return null;
    t.usedAt = now;
    return t.userId;
  }
  async saveVerificationToken(userId: string, tokenHash: string, expiresAt: Date) {
    this.verification.push({ userId, tokenHash, expiresAt, usedAt: null, createdAt: this.clock.now() });
  }
  async consumeVerificationToken(tokenHash: string, now: Date) {
    const t = this.verification.find((v) => v.tokenHash === tokenHash && !v.usedAt && v.expiresAt > now);
    if (!t) return null;
    t.usedAt = now;
    return t.userId;
  }
  async findVerificationToken(tokenHash: string) {
    const t = this.verification.find((v) => v.tokenHash === tokenHash);
    return t ? { userId: t.userId, usedAt: t.usedAt } : null;
  }
  async latestVerificationTokenAt(userId: string) {
    const mine = this.verification.filter((v) => v.userId === userId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return mine[0]?.createdAt ?? null;
  }
}

class FakeGoogle implements GoogleIdTokenVerifier {
  identities = new Map<string, GoogleIdentity>();
  constructor(public configured = true) {}
  async verify(credential: string) {
    return this.identities.get(credential) ?? null;
  }
}

const plainHasher: PasswordHasher = {
  hash: async (p) => `hashed:${p}`,
  verify: async (p, h) => h === `hashed:${p}`,
};

function harness(opts: { googleConfigured?: boolean } = {}) {
  const clock = new FakeClock();
  const config = testConfig();
  const settings = settingsService();
  const users = new InMemoryUsersRepository(clock);
  const email = new RecordingEmailSender();
  const notifications = new NotificationsService(email, config, settings);
  const claimed: { userId: string; email: string }[] = [];
  const orders = { claimGuestOrders: async (userId: string, e: string) => void claimed.push({ userId, email: e }) };
  const verification = new EmailVerificationService(users, orders, clock, notifications);
  const creditRepo = new InMemoryCreditRepository(clock);
  const credit = new CreditService(creditRepo, clock, settings);
  const tokens = {
    signAccess: (u: { id: string }) => `access-${u.id}`,
    issueRefresh: async () => ({ token: 'refresh', expiresAt: clock.now() }),
  } as unknown as TokenService;
  const content = { subscribe: async () => undefined } as unknown as ContentRepository;
  const google = new FakeGoogle(opts.googleConfigured ?? true);
  const auth = new AuthService(users, plainHasher, clock, content, tokens, credit, notifications, verification, google);
  /** The raw token from the last confirmation email's link. */
  const lastLinkToken = () => {
    const text = email.sent.at(-1)?.text ?? '';
    const m = /view=verify&token=([^\s&]+)/.exec(text);
    return m ? decodeURIComponent(m[1]) : null;
  };
  /** The raw token from the last password-reset email's link. */
  const lastResetToken = () => {
    const text = email.sent.at(-1)?.text ?? '';
    const m = /view=reset&token=([^\s&]+)/.exec(text);
    return m ? decodeURIComponent(m[1]) : null;
  };
  return { clock, users, email, verification, auth, creditRepo, claimed, google, lastLinkToken, lastResetToken };
}

const registration = { email: 'Ada@Example.com', password: 'Passw0rd!x', firstName: 'Ada', lastName: 'Obi', marketingConsent: false };

describe('email verification (sign-up)', () => {
  it('registers unverified, signs in anyway and emails a 24 h confirmation link (only the hash is stored)', async () => {
    const h = harness();
    const res = await h.auth.register(registration);
    expect(res.accessToken).toBeTruthy();
    expect(res.user).toMatchObject({ email: 'ada@example.com', emailVerified: false });
    const mail = h.email.sent.at(-1)!;
    expect(mail.to).toBe('ada@example.com');
    expect(mail.subject).toBe('Confirm your email');
    expect(mail.html).toContain('https://shop.test/account?view=verify&amp;token=');
    const token = h.lastLinkToken()!;
    expect(h.users.verification).toHaveLength(1);
    expect(h.users.verification[0].tokenHash).toBe(sha256(token));
    expect(h.users.verification[0].tokenHash).not.toBe(token);
    expect(h.users.verification[0].expiresAt.getTime() - h.clock.now().getTime()).toBe(24 * 3_600_000);
  });

  it('verify marks the account verified, claims guest orders, and a second click is harmless', async () => {
    const h = harness();
    const { user } = await h.auth.register(registration);
    const token = h.lastLinkToken()!;
    const verified = await h.auth.verifyEmail(token);
    expect(verified).toMatchObject({ id: user.id, emailVerified: true });
    expect(h.users.users[0].emailVerifiedAt).toEqual(h.clock.now());
    expect(h.claimed).toEqual([{ userId: user.id, email: 'ada@example.com' }]);
    // Clicking the same link again returns the (already verified) user instead of an error.
    await expect(h.auth.verifyEmail(token)).resolves.toMatchObject({ emailVerified: true });
    expect(h.claimed).toHaveLength(1);
  });

  it('rejects unknown and expired links with 400', async () => {
    const h = harness();
    await h.auth.register(registration);
    const token = h.lastLinkToken()!;
    await expect(h.auth.verifyEmail('not-a-token')).rejects.toThrow(INVALID_VERIFICATION_LINK);
    h.clock.advance(24 * 3_600_000 + 1);
    await expect(h.auth.verifyEmail(token)).rejects.toBeInstanceOf(BadRequestException);
    expect(h.users.users[0].emailVerifiedAt).toBeNull();
  });

  it('resend: cooldown of a minute, then a fresh link; no-op once verified', async () => {
    const h = harness();
    const { user } = await h.auth.register(registration);
    expect(await h.auth.resendVerification(user.id)).toEqual({ ok: true, sent: false }); // just sent at sign-up
    h.clock.advance(61_000);
    expect(await h.auth.resendVerification(user.id)).toEqual({ ok: true, sent: true });
    expect(h.email.sent).toHaveLength(2);
    await h.auth.verifyEmail(h.lastLinkToken()!);
    h.clock.advance(61_000);
    expect(await h.auth.resendVerification(user.id)).toEqual({ ok: true, sent: false });
    expect(h.email.sent).toHaveLength(2);
  });

  it('credit tied to the email is hidden until the account is verified', async () => {
    const h = harness();
    await h.creditRepo.add({ email: 'ada@example.com', amountKobo: 5_000_000, reason: 'EXCHANGE_CREDIT' });
    const { user } = await h.auth.register(registration);
    expect(user.creditBalanceKobo).toBe(0);
    expect((await h.auth.verifyEmail(h.lastLinkToken()!)).creditBalanceKobo).toBe(5_000_000);
  });
});

describe('Google sign-in', () => {
  const identity = (over: Partial<GoogleIdentity> = {}): GoogleIdentity => ({
    sub: 'g-123',
    email: 'ada@example.com',
    emailVerified: true,
    givenName: 'Ada',
    familyName: 'Obi',
    ...over,
  });

  it('503 when GOOGLE_CLIENT_ID is not configured; 401 for bad or unverified tokens', async () => {
    await expect(harness({ googleConfigured: false }).auth.googleSignIn('x')).rejects.toBeInstanceOf(ServiceUnavailableException);
    const h = harness();
    await expect(h.auth.googleSignIn('garbage')).rejects.toBeInstanceOf(UnauthorizedException);
    h.google.identities.set('cred', identity({ emailVerified: false }));
    await expect(h.auth.googleSignIn('cred')).rejects.toThrow('not verified');
  });

  it('creates a verified CUSTOMER with names from the token and no usable password', async () => {
    const h = harness();
    h.google.identities.set('cred', identity());
    const res = await h.auth.googleSignIn('cred');
    expect(res.user).toMatchObject({ email: 'ada@example.com', firstName: 'Ada', lastName: 'Obi', emailVerified: true });
    expect(res.refresh.token).toBe('refresh');
    const row = h.users.users[0];
    expect(row).toMatchObject({ role: 'CUSTOMER', googleSub: 'g-123' });
    expect(await plainHasher.verify('', row.passwordHash)).toBe(false);
    expect(h.claimed).toEqual([{ userId: row.id, email: 'ada@example.com' }]);
    // Next time: found by sub, same account.
    expect((await h.auth.googleSignIn('cred')).user.id).toBe(row.id);
    expect(h.users.users).toHaveLength(1);
  });

  it('links an existing unverified account, verifies it and invalidates the unproven password + sessions', async () => {
    const h = harness();
    const { user } = await h.auth.register(registration);
    h.google.identities.set('cred', identity());
    const res = await h.auth.googleSignIn('cred');
    expect(res.user).toMatchObject({ id: user.id, emailVerified: true });
    expect(h.users.users[0].googleSub).toBe('g-123');
    expect(h.users.revokedFor).toEqual([user.id]);
    await expect(h.auth.login('ada@example.com', 'Passw0rd!x')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('keeps the password of an already-verified account; refuses admins and a different Google account', async () => {
    const h = harness();
    const { user } = await h.auth.register(registration);
    await h.auth.verifyEmail(h.lastLinkToken()!);
    h.google.identities.set('cred', identity());
    await h.auth.googleSignIn('cred');
    await expect(h.auth.login('ada@example.com', 'Passw0rd!x')).resolves.toMatchObject({ user: { id: user.id } });
    h.google.identities.set('other', identity({ sub: 'g-999' }));
    await expect(h.auth.googleSignIn('other')).rejects.toBeInstanceOf(ConflictException);

    await h.users.create({ email: 'boss@example.com', passwordHash: 'x', firstName: 'B', lastName: 'A', phone: null, marketingConsent: false, role: 'ADMIN' });
    h.google.identities.set('admin', identity({ sub: 'g-admin', email: 'boss@example.com' }));
    await expect(h.auth.googleSignIn('admin')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('email + Google sign-in stay on one account', () => {
  const identity = (over: Partial<GoogleIdentity> = {}): GoogleIdentity => ({
    sub: 'g-123', email: 'ada@example.com', emailVerified: true, givenName: 'Ada', familyName: 'Obi', ...over,
  });
  const setPasswordByEmail = async (h: ReturnType<typeof harness>, address: string, password: string) => {
    await h.auth.forgotPassword(address);
    const token = h.lastResetToken();
    expect(token).toBeTruthy();
    await h.auth.resetPassword(token!, password);
  };

  it('Google first: password sign-in explains it is a Google account; "Forgot password" adds one and both then work', async () => {
    const h = harness();
    h.google.identities.set('cred', identity());
    const first = await h.auth.googleSignIn('cred');
    await expect(h.auth.login('ada@example.com', 'anything')).rejects.toThrow(GOOGLE_ONLY_MESSAGE);
    await setPasswordByEmail(h, 'ADA@example.com', 'N3wPassw0rd!');
    expect((await h.auth.login('Ada@Example.com', 'N3wPassw0rd!')).user.id).toBe(first.user.id);
    expect((await h.auth.googleSignIn('cred')).user.id).toBe(first.user.id);
    expect(h.users.users).toHaveLength(1);
  });

  it('email first (confirmed): Google links to the same account and the password keeps working', async () => {
    const h = harness();
    const { user } = await h.auth.register(registration);
    await h.auth.verifyEmail(h.lastLinkToken()!);
    h.google.identities.set('cred', identity());
    expect((await h.auth.googleSignIn('cred')).user.id).toBe(user.id);
    expect((await h.auth.login('ada@example.com', registration.password)).user.id).toBe(user.id);
    expect(h.users.users).toHaveLength(1);
  });

  it('email first (never confirmed): Google takes over safely, then the owner can set a password again', async () => {
    const h = harness();
    const { user } = await h.auth.register(registration);
    h.google.identities.set('cred', identity());
    expect((await h.auth.googleSignIn('cred')).user.id).toBe(user.id);
    await expect(h.auth.login('ada@example.com', registration.password)).rejects.toThrow(GOOGLE_ONLY_MESSAGE);
    await setPasswordByEmail(h, 'ada@example.com', 'N3wPassw0rd!');
    expect((await h.auth.login('ada@example.com', 'N3wPassw0rd!')).user.id).toBe(user.id);
    expect((await h.auth.googleSignIn('cred')).user.id).toBe(user.id);
  });

  it('the admin email gets a clear pointer to /admin (only once the password is right) — never a customer session', async () => {
    const h = harness();
    await h.users.create({ email: 'boss@example.com', passwordHash: 'hashed:Adm1nPass!', firstName: 'B', lastName: 'A', phone: null, marketingConsent: false, role: 'ADMIN' });
    await expect(h.auth.login('boss@example.com', 'wrong')).rejects.toThrow('Incorrect email or password');
    await expect(h.auth.login('boss@example.com', 'Adm1nPass!')).rejects.toThrow(ADMIN_ACCOUNT_MESSAGE);
    h.google.identities.set('admin', identity({ sub: 'g-admin', email: 'boss@example.com' }));
    await expect(h.auth.googleSignIn('admin')).rejects.toThrow(ADMIN_ACCOUNT_MESSAGE);
  });
});
