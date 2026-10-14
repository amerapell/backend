/* Runs committed Drizzle migrations from ./drizzle. Used on Railway start: `npm run migrate`. */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as path from 'path';
import { createPool } from './database.module';

async function main(): Promise<void> {
  // Migrations only need the database — don't block them on app settings like FRONTEND_URL.
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error('DATABASE_URL is not set. On Railway, add DATABASE_URL = ${{Postgres.DATABASE_URL}} to the backend service variables.');
  const pool = createPool(databaseUrl);
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
