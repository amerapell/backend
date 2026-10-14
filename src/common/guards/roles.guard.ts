import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AccessTokenVerifier } from './token-verifier';
import type { AuthUser, Role } from '../auth-types';

/** Authenticates and enforces @Roles(...). Used on every /admin/* controller with @Roles('ADMIN'). */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: AccessTokenVerifier,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!roles || roles.length === 0) return true;
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = this.verifier.extract(req.headers.authorization);
    const user = token ? this.verifier.verify(token) : null;
    if (!user) throw new UnauthorizedException('Authentication required');
    if (!roles.includes(user.role)) throw new ForbiddenException('Insufficient role');
    req.user = user;
    return true;
  }
}
