/* Runs committed Drizzle migrations from ./drizzle. Used on Railway start: `npm run migrate`. */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as path from 'path';
import { loadConfig } from '../config/app-config';
import { createPool } from './database.module';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const db = drizzle(pool);
  const migrationsFolder = path.resolve(__dirname, '..', '..', 'drizzle');
  console.log(`[migrate] applying migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  console.log('[migrate] done');
  await pool.end();
}

main().catch((err) => {
  console.error('[migrate] failed', err);
  process.exit(1);
});
