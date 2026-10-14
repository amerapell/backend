import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DRIZZLE, Database } from '../db/database.module';
import { storeSettings } from '../db/schema';
import type { SettingsRepository, StoredSettings } from './settings.types';

const KEY = 'default';

@Injectable()
export class DrizzleSettingsRepository implements SettingsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async load(): Promise<Partial<StoredSettings> | null> {
    const [row] = await this.db.select().from(storeSettings).where(eq(storeSettings.id, KEY)).limit(1);
    return (row?.data as Partial<StoredSettings>) ?? null;
  }

  async save(settings: StoredSettings): Promise<void> {
    await this.db
      .insert(storeSettings)
      .values({ id: KEY, data: settings })
      .onConflictDoUpdate({ target: storeSettings.id, set: { data: settings, updatedAt: new Date() } });
  }

  async availableInCollection(collectionSlug: string): Promise<number> {
    const res = await this.db.execute<{ left: string | null }>(sql`
      SELECT COALESCE(SUM(GREATEST(v.stock - COALESCE(h.held, 0), 0)), 0) AS left
      FROM variants v
      JOIN products p ON p.id = v.product_id AND p.status = 'LIVE'
      JOIN product_collections pc ON pc.product_id = p.id
      JOIN collections c ON c.id = pc.collection_id AND c.slug = ${collectionSlug}
      LEFT JOIN (
        SELECT variant_id, SUM(quantity) AS held FROM stock_holds
        WHERE released_at IS NULL AND consumed_at IS NULL AND expires_at > now()
        GROUP BY variant_id
      ) h ON h.variant_id = v.id
      WHERE v.archived = false`);
    return Number(res.rows[0]?.left ?? 0);
  }
}
