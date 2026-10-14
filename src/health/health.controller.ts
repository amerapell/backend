import { Controller, Get, Inject } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Pool } from 'pg';
import { PG_POOL } from '../db/database.module';

@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Liveness for Railway: `{ ok: true }`. */
  @Get()
  health() {
    return { ok: true };
  }

  /** Addition: readiness incl. a database round-trip. */
  @Get('ready')
  async ready() {
    const started = Date.now();
    await this.pool.query('SELECT 1');
    return { ok: true, db: 'up', latencyMs: Date.now() - started };
  }
}
