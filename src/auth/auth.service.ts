import { BadRequestException, ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
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

export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
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
  ) {}

  async publicUser(u: UserRow): Promise<PublicUser> {
    return {
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      phone: u.phone,
      creditBalanceKobo: await this.credit.balance(u.email),
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
    const user = await this.validateCredentials(email, password);
    if (user.role !== 'CUSTOMER') throw new UnauthorizedException('Incorrect email or password');
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
