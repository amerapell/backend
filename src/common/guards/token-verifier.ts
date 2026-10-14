import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppConfig } from '../../config/app-config';
import type { AccessTokenPayload, AuthUser } from '../auth-types';

/** Verifies bearer access tokens. Shared by all auth guards. */
@Injectable()
export class AccessTokenVerifier {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
  ) {}

  extract(authorization: string | undefined): string | null {
    if (!authorization) return null;
    const [scheme, token] = authorization.split(' ');
    return scheme?.toLowerCase() === 'bearer' && token ? token : null;
  }

  verify(token: string): AuthUser | null {
    try {
      const p = this.jwt.verify<AccessTokenPayload>(token, { secret: this.config.values.jwtAccessSecret });
      if (p.typ !== 'access' || !p.sub) return null;
      return { id: p.sub, email: p.email, role: p.role };
    } catch {
      return null;
    }
  }
}
