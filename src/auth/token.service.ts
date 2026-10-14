import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHmac } from 'crypto';
import { AppConfig } from '../config/app-config';
import { addDays, CLOCK, Clock } from '../common/clock';
import { randomToken } from '../common/ids';
import type { AccessTokenPayload, Role } from '../common/auth-types';
import { USERS_REPOSITORY, UsersRepository } from './users.repository';

export const REFRESH_COOKIE = 'ap_rt';

/** Access JWTs (15 min customer / 8 h admin) and rotating opaque refresh tokens stored as HMACs. */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    @Inject(USERS_REPOSITORY) private readonly users: UsersRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  signAccess(user: { id: string; email: string; role: Role }): string {
    const payload: AccessTokenPayload = { sub: user.id, email: user.email, role: user.role, typ: 'access' };
    const ttl = user.role === 'ADMIN' ? this.config.values.adminAccessTokenTtlSeconds : this.config.values.accessTokenTtlSeconds;
    return this.jwt.sign(payload, { secret: this.config.values.jwtAccessSecret, expiresIn: ttl });
  }

  hashRefresh(raw: string): string {
    return createHmac('sha256', this.config.values.jwtRefreshSecret).update(raw).digest('hex');
  }

  async issueRefresh(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomToken(48);
    const expiresAt = addDays(this.clock.now(), this.config.values.refreshTokenTtlDays);
    await this.users.saveRefreshToken(userId, this.hashRefresh(token), expiresAt);
    return { token, expiresAt };
  }

  /** Rotation: the presented token is revoked and a new one issued. */
  async rotate(raw: string): Promise<{ userId: string; token: string; expiresAt: Date } | null> {
    const found = await this.users.findActiveRefreshToken(this.hashRefresh(raw), this.clock.now());
    if (!found) return null;
    await this.users.revokeRefreshToken(found.id, this.clock.now());
    const next = await this.issueRefresh(found.userId);
    return { userId: found.userId, ...next };
  }

  async revoke(raw: string): Promise<void> {
    const found = await this.users.findActiveRefreshToken(this.hashRefresh(raw), this.clock.now());
    if (found) await this.users.revokeRefreshToken(found.id, this.clock.now());
  }

  /** Short-lived token proving the admin passed the password step (TOTP second step). */
  signTotpChallenge(userId: string): string {
    return this.jwt.sign({ sub: userId, typ: 'admin-totp' }, { secret: this.config.values.jwtAccessSecret, expiresIn: 300 });
  }

  verifyTotpChallenge(token: string): string | null {
    try {
      const p = this.jwt.verify<{ sub: string; typ: string }>(token, { secret: this.config.values.jwtAccessSecret });
      return p.typ === 'admin-totp' ? p.sub : null;
    } catch {
      return null;
    }
  }
}
