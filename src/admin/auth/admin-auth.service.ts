import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../../auth/auth.service';
import { TokenService } from '../../auth/token.service';
import { USERS_REPOSITORY, UsersRepository } from '../../auth/users.repository';
import { TOTP, TotpService } from './totp';

export type AdminLoginResult = { requiresTotp: true; tempToken: string } | { requiresTotp: false; accessToken: string; totpEnabled: false };

/** ADM-6: one admin, email + password, then TOTP as the second step once enrolled. */
@Injectable()
export class AdminAuthService {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    @Inject(USERS_REPOSITORY) private readonly users: UsersRepository,
    @Inject(TOTP) private readonly totp: TotpService,
  ) {}

  async login(email: string, password: string): Promise<AdminLoginResult> {
    const user = await this.auth.validateCredentials(email, password).catch(() => null);
    if (!user || user.role !== 'ADMIN') throw new UnauthorizedException('Incorrect email or password');
    if (user.totpEnabled && user.totpSecret) return { requiresTotp: true, tempToken: this.tokens.signTotpChallenge(user.id) };
    return { requiresTotp: false, accessToken: this.tokens.signAccess(user), totpEnabled: false };
  }

  async verifyTotp(tempToken: string, code: string): Promise<{ accessToken: string }> {
    const userId = this.tokens.verifyTotpChallenge(tempToken);
    const user = userId ? await this.users.findById(userId) : null;
    if (!user || user.role !== 'ADMIN' || !user.totpSecret || !user.totpEnabled) throw new UnauthorizedException('Sign-in expired — start again');
    if (!this.totp.verify(code, user.totpSecret)) throw new UnauthorizedException('Incorrect code');
    return { accessToken: this.tokens.signAccess(user) };
  }

  async setup(adminId: string): Promise<{ otpauthUrl: string; secret: string }> {
    const user = await this.users.findById(adminId);
    if (!user || user.role !== 'ADMIN') throw new UnauthorizedException();
    if (user.totpEnabled) throw new BadRequestException('Two-step verification is already enabled');
    const secret = this.totp.generateSecret();
    await this.users.update(user.id, { totpSecret: secret, totpEnabled: false });
    return { otpauthUrl: this.totp.keyUri(user.email, secret), secret };
  }

  async enable(adminId: string, code: string): Promise<{ ok: true }> {
    const user = await this.users.findById(adminId);
    if (!user || user.role !== 'ADMIN' || !user.totpSecret) throw new BadRequestException('Run setup first');
    if (!this.totp.verify(code, user.totpSecret)) throw new BadRequestException('Incorrect code');
    await this.users.update(user.id, { totpEnabled: true });
    return { ok: true };
  }
}
