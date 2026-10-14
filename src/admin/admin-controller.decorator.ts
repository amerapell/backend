import { applyDecorators, Controller, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

/** Every admin controller: /admin/<path>, ADMIN role, stricter rate limit. */
export function AdminController(path: string) {
  return applyDecorators(Controller(`admin/${path}`), UseGuards(RolesGuard), Roles('ADMIN'), Throttle({ default: { limit: 120, ttl: 60_000 } }));
}
