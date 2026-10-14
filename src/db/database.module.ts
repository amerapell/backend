import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { AppConfig } from '../config/app-config';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
/** A transaction handle has the same query API as the database. */
export type DbExecutor = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute' | 'query'>;

export const DRIZZLE = Symbol('DRIZZLE');
export const PG_POOL = Symbol('PG_POOL');

export function createPool(databaseUrl: string): Pool {
  const needsSsl = /sslmode=require/.test(databaseUrl) || process.env.PGSSL === 'true';
  return new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.PG_POOL_MAX ?? 10),
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });
}

@Injectable()
class PoolCloser implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    { provide: PG_POOL, inject: [AppConfig], useFactory: (c: AppConfig) => createPool(c.values.databaseUrl) },
    { provide: DRIZZLE, inject: [PG_POOL], useFactory: (pool: Pool): Database => drizzle(pool, { schema }) },
    PoolCloser,
  ],
  exports: [DRIZZLE, PG_POOL],
})
export class DatabaseModule {}
