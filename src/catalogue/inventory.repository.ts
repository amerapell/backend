import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, Database } from '../db/database.module';
import type { ProductStatus } from '../common/contract';
import { HELD_BY_VARIANT } from './catalogue.repository';

export const INVENTORY_REPOSITORY = Symbol('INVENTORY_REPOSITORY');

/** A denormalised, read-only view of a variant with live availability — what cart/checkout need. */
export interface VariantSnapshot {
  variantId: string;
  productId: string;
  productSlug: string;
  productName: string;
  number: string;
  material: string | null;
  sku: string;
  colour: string | null;
  colourHex: string | null;
  size: string | null;
  priceKobo: number;
  compareAtKobo: number | null;
  stock: number;
  available: number;
  archived: boolean;
  productStatus: ProductStatus;
  imageUrl: string | null;
  /** In a drop that has not gone live yet. */
  scheduled: boolean;
  exchangeable: boolean;
}

export interface InventoryRepository {
  getSnapshots(variantIds: string[], now: Date): Promise<VariantSnapshot[]>;
}

export function isPurchasable(s: VariantSnapshot): boolean {
  return s.productStatus === 'LIVE' && !s.archived && !s.scheduled;
}

@Injectable()
export class DrizzleInventoryRepository implements InventoryRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async getSnapshots(variantIds: string[], now: Date): Promise<VariantSnapshot[]> {
    if (!variantIds.length) return [];
    const res = await this.db.execute<Record<string, unknown>>(sql`
      SELECT v.id AS variant_id, p.id AS product_id, p.slug, p.name, p.number, p.material, v.sku, v.colour, v.colour_hex, v.size,
        v.price_kobo, v.compare_at_kobo, v.stock, (v.stock - COALESCE(h.held, 0))::int AS available, v.archived, p.status,
        (SELECT i.url FROM product_images i WHERE i.product_id = p.id
           ORDER BY (CASE WHEN v.colour IS NOT NULL AND LOWER(i.colour) = LOWER(v.colour) THEN 0 WHEN i.colour IS NULL THEN 1 ELSE 2 END), i.sort_order
           LIMIT 1) AS image_url,
        EXISTS (SELECT 1 FROM product_collections pc JOIN collections c ON c.id = pc.collection_id
           WHERE pc.product_id = p.id AND c.is_drop AND c.go_live_at IS NOT NULL AND c.go_live_at > ${now.toISOString()}::timestamptz) AS scheduled,
        (p.exchangeable AND NOT EXISTS (SELECT 1 FROM product_collections pc JOIN collections c ON c.id = pc.collection_id
           WHERE pc.product_id = p.id AND c.exchangeable = false)) AS exchangeable
      FROM variants v
      JOIN products p ON p.id = v.product_id
      LEFT JOIN ${HELD_BY_VARIANT} h ON h.variant_id = v.id
      WHERE v.id IN (${sql.join(variantIds.map((id) => sql`${id}`), sql`, `)})`);
    return res.rows.map((r) => ({
      variantId: String(r.variant_id),
      productId: String(r.product_id),
      productSlug: String(r.slug),
      productName: String(r.name),
      number: String(r.number),
      material: (r.material as string | null) ?? null,
      sku: String(r.sku),
      colour: (r.colour as string | null) ?? null,
      colourHex: (r.colour_hex as string | null) ?? null,
      size: (r.size as string | null) ?? null,
      priceKobo: Number(r.price_kobo),
      compareAtKobo: r.compare_at_kobo === null ? null : Number(r.compare_at_kobo),
      stock: Number(r.stock),
      available: Math.max(0, Number(r.available)),
      archived: Boolean(r.archived),
      productStatus: r.status as ProductStatus,
      imageUrl: (r.image_url as string | null) ?? null,
      scheduled: Boolean(r.scheduled),
      exchangeable: Boolean(r.exchangeable),
    }));
  }
}
