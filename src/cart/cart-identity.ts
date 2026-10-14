import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../common/auth-types';
import type { CartIdentity } from './cart.service';

/** Reads `X-Cart-Token` and (if OptionalJwtAuthGuard attached one) the user. */
export const CartIdentityParam = createParamDecorator((_d: unknown, ctx: ExecutionContext): CartIdentity => {
  const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
  const header = req.headers['x-cart-token'];
  const token = Array.isArray(header) ? header[0] : header;
  return { token: token?.trim() || null, userId: req.user?.role === 'CUSTOMER' ? req.user.id : null };
});
