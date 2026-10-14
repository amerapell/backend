import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AccessTokenVerifier } from './token-verifier';
import type { AuthUser } from '../auth-types';

/** Requires a valid access token (customer or admin). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly verifier: AccessTokenVerifier) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = this.verifier.extract(req.headers.authorization);
    const user = token ? this.verifier.verify(token) : null;
    if (!user) throw new UnauthorizedException('Authentication required');
    req.user = user;
    return true;
  }
}

/** Attaches the user when a valid token is present, but never rejects. */
@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(private readonly verifier: AccessTokenVerifier) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = this.verifier.extract(req.headers.authorization);
    const user = token ? this.verifier.verify(token) : null;
    if (user) req.user = user;
    return true;
  }
}
