import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, inArray, sql, SQL } from 'drizzle-orm';
import { DRIZZLE, Database } from '../db/database.module';
import { collections, productCollections, productImages, products } from '../db/schema';
import type { CollectionRow } from '../db/schema';
import type { Colour, ProductStatus } from '../common/contract';
import type { ProductAggregate, VariantWithAvailability } from './product-presenter';

export const CATALOGUE_REPOSITORY = Symbol('CATALOGUE_REPOSITORY');

export type SortKey = 'newest' | 'price_asc' | 'price_desc';

export interface ProductFilter {
  collectionSlug?: string;
  q?: string;
  sizes?: string[];
  colours?: string[];
  minKobo?: number;
  maxKobo?: number;
  inStock?: boolean;
  sort: SortKey;
  page: number;
  pageSize: number;
  now: Date;
  /** Admin listing: statuses to include (also includes scheduled drop products). Omitted = public view. */
  statuses?: ProductStatus[];
}

export interface Facets {
  sizes: string[];
  colours: Colour[];
  priceRangeKobo: [number, number];
}

export interface CatalogueRepository {
  listCollections(now: Date): Promise<{ collection: CollectionRow; count: number }[]>;
  findCollectionBySlug(slug: string): Promise<CollectionRow | null>;
  countPublicProducts(collectionId: string, now: Date): Promise<number>;
  searchProductIds(filter: ProductFilter): Promise<{ ids: string[]; total: number }>;
  loadAggregates(ids: string[]): Promise<ProductAggregate[]>;
  findProductIdBySlug(slug: string): Promise<string | null>;
  relatedProductIds(productId: string, collectionIds: string[], limit: number, now: Date): Promise<string[]>;
  facets(collectionId: string, now: Date): Promise<Facets>;
  suggestCollections(q: string, limit: number): Promise<CollectionRow[]>;
}

/** Units held by unexpired, unreleased, unconsumed holds — per variant. */
export const HELD_BY_VARIANT = sql`(
  SELECT variant_id, SUM(quantity)::int AS held FROM stock_holds
  WHERE released_at IS NULL AND consumed_at IS NULL AND expires_at > now()
  GROUP BY variant_id)`;

/** Public visibility: LIVE and not inside a drop collection that has not gone live yet. */
export function publicProductCondition(now: Date): SQL {
  return sql`p.status = 'LIVE' AND NOT EXISTS (
    SELECT 1 FROM product_collections pc2 JOIN collections c2 ON c2.id = pc2.collection_id
    WHERE pc2.product_id = p.id AND c2.is_drop = true AND c2.go_live_at IS NOT NULL AND c2.go_live_at > ${now.toISOString()}::timestamptz)`;
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => '\\' + m);
}

@Injectable()
export class DrizzleCatalogueRepository implements CatalogueRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async listCollections(now: Date): Promise<{ collection: CollectionRow; count: number }[]> {
    const rows = await this.db.select().from(collections).orderBy(asc(collections.sortOrder), asc(collections.name));
    const counts = await this.db.execute<{ collection_id: string; count: number }>(sql`
      SELECT pc.collection_id, COUNT(DISTINCT p.id)::int AS count
      FROM product_collections pc JOIN products p ON p.id = pc.product_id
      WHERE ${publicProductCondition(now)}
      GROUP BY pc.collection_id`);
    const byId = new Map(counts.rows.map((r) => [r.collection_id, Number(r.count)]));
    return rows.map((c) => ({ collection: c, count: byId.get(c.id) ?? 0 }));
  }

  async findCollectionBySlug(slug: string): Promise<CollectionRow | null> {
    const [row] = await this.db.select().from(collections).where(eq(collections.slug, slug)).limit(1);
    return row ?? null;
  }

  async countPublicProducts(collectionId: string, now: Date): Promise<number> {
    const res = await this.db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count FROM products p
      JOIN product_collections pc ON pc.product_id = p.id AND pc.collection_id = ${collectionId}
      WHERE ${publicProductCondition(now)}`);
    return Number(res.rows[0]?.count ?? 0);
  }

  async searchProductIds(f: ProductFilter): Promise<{ ids: string[]; total: number }> {
    const conds: SQL[] = [];
    if (f.statuses?.length) {
      conds.push(sql`p.status IN (${sql.join(f.statuses.map((s) => sql`${s}`), sql`, `)})`);
    } else {
      conds.push(publicProductCondition(f.now));
    }
    if (f.collectionSlug) {
      conds.push(sql`EXISTS (SELECT 1 FROM product_collections pc JOIN collections c ON c.id = pc.collection_id
        WHERE pc.product_id = p.id AND c.slug = ${f.collectionSlug})`);
    }
    const q = f.q?.trim();
    if (q) {
      const like = `%${escapeLike(q)}%`;
      conds.push(sql`(p.name ILIKE ${like} OR p.number ILIKE ${like} OR COALESCE(p.material, '') ILIKE ${like}
        OR word_similarity(${q}, p.name) > 0.35 OR word_similarity(${q}, COALESCE(p.material, '')) > 0.45)`);
    }
    const variantConds: SQL[] = [sql`v.product_id = p.id`, sql`v.archived = false`];
    if (f.sizes?.length) variantConds.push(sql`LOWER(v.size) IN (${sql.join(f.sizes.map((s) => sql`${s.toLowerCase()}`), sql`, `)})`);
    if (f.colours?.length) variantConds.push(sql`LOWER(v.colour) IN (${sql.join(f.colours.map((c) => sql`${c.toLowerCase()}`), sql`, `)})`);
    if (f.minKobo !== undefined) variantConds.push(sql`v.price_kobo >= ${f.minKobo}`);
    if (f.maxKobo !== undefined) variantConds.push(sql`v.price_kobo <= ${f.maxKobo}`);
    if (f.inStock) variantConds.push(sql`v.stock - COALESCE((SELECT h.held FROM ${HELD_BY_VARIANT} h WHERE h.variant_id = v.id), 0) > 0`);
    if (variantConds.length > 2) conds.push(sql`EXISTS (SELECT 1 FROM variants v WHERE ${sql.join(variantConds, sql` AND `)})`);

    const minPrice = sql`(SELECT MIN(v.price_kobo) FROM variants v WHERE v.product_id = p.id AND v.archived = false)`;
    let orderBy: SQL;
    if (f.sort === 'price_asc') orderBy = sql`${minPrice} ASC NULLS LAST, p.created_at DESC`;
    else if (f.sort === 'price_desc') orderBy = sql`${minPrice} DESC NULLS LAST, p.created_at DESC`;
    else if (q) orderBy = sql`GREATEST(word_similarity(${q}, p.name), similarity(${q}, p.name)) DESC, p.created_at DESC`;
    else orderBy = sql`p.created_at DESC, p.id`;

    const offset = (f.page - 1) * f.pageSize;
    const res = await this.db.execute<{ id: string; total: number }>(sql`
      SELECT p.id, COUNT(*) OVER()::int AS total FROM products p
      WHERE ${sql.join(conds, sql` AND `)}
      ORDER BY ${orderBy}
      LIMIT ${f.pageSize} OFFSET ${offset}`);
    let total = Number(res.rows[0]?.total ?? 0);
    if (res.rows.length === 0 && offset > 0) {
      const c = await this.db.execute<{ total: number }>(sql`SELECT COUNT(*)::int AS total FROM products p WHERE ${sql.join(conds, sql` AND `)}`);
      total = Number(c.rows[0]?.total ?? 0);
    }
    return { ids: res.rows.map((r) => r.id), total };
  }

  async loadAggregates(ids: string[]): Promise<ProductAggregate[]> {
    if (!ids.length) return [];
    const [prodRows, variantRows, imageRows, collectionRows] = await Promise.all([
      this.db.select().from(products).where(inArray(products.id, ids)),
      this.db.execute<Record<string, unknown>>(sql`
        SELECT v.*, (v.stock - COALESCE(h.held, 0))::int AS available
        FROM variants v LEFT JOIN ${HELD_BY_VARIANT} h ON h.variant_id = v.id
        WHERE v.product_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`),
      this.db.select().from(productImages).where(inArray(productImages.productId, ids)),
      this.db
        .select({ productId: productCollections.productId, collection: collections })
        .from(productCollections)
        .innerJoin(collections, eq(collections.id, productCollections.collectionId))
        .where(inArray(productCollections.productId, ids)),
    ]);
    const vs = variantRows.rows.map(mapVariantRow);
    const byId = new Map(prodRows.map((p) => [p.id, p]));
    return ids
      .map((pid) => byId.get(pid))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => ({
        product: p,
        variants: vs.filter((v) => v.productId === p.id),
        images: imageRows.filter((i) => i.productId === p.id),
        collections: collectionRows.filter((c) => c.productId === p.id).map((c) => c.collection),
      }));
  }

  async findProductIdBySlug(slug: string): Promise<string | null> {
    const [row] = await this.db.select({ id: products.id }).from(products).where(eq(products.slug, slug)).limit(1);
    return row?.id ?? null;
  }

  async relatedProductIds(productId: string, collectionIds: string[], limit: number, now: Date): Promise<string[]> {
    if (!collectionIds.length) return [];
    const res = await this.db.execute<{ id: string }>(sql`
      SELECT p.id FROM products p
      WHERE ${publicProductCondition(now)} AND p.id <> ${productId}
        AND EXISTS (SELECT 1 FROM product_collections pc WHERE pc.product_id = p.id
          AND pc.collection_id IN (${sql.join(collectionIds.map((c) => sql`${c}`), sql`, `)}))
      ORDER BY (SELECT COUNT(*) FROM product_collections pc WHERE pc.product_id = p.id
          AND pc.collection_id IN (${sql.join(collectionIds.map((c) => sql`${c}`), sql`, `)})) DESC, p.created_at DESC
      LIMIT ${limit}`);
    return res.rows.map((r) => r.id);
  }

  async facets(collectionId: string, now: Date): Promise<Facets> {
    const base = sql`FROM variants v JOIN products p ON p.id = v.product_id
      JOIN product_collections pc ON pc.product_id = p.id AND pc.collection_id = ${collectionId}
      WHERE v.archived = false AND ${publicProductCondition(now)}`;
    const [sizes, colours, range] = await Promise.all([
      this.db.execute<{ size: string; pos: number }>(sql`SELECT v.size, MIN(v.position) AS pos ${base} AND v.size IS NOT NULL GROUP BY v.size ORDER BY pos, v.size`),
      this.db.execute<{ name: string; hex: string }>(sql`SELECT v.colour AS name, MIN(v.colour_hex) AS hex ${base} AND v.colour IS NOT NULL GROUP BY v.colour ORDER BY v.colour`),
      this.db.execute<{ min: number | null; max: number | null }>(sql`SELECT MIN(v.price_kobo)::int AS min, MAX(v.price_kobo)::int AS max ${base}`),
    ]);
    return {
      sizes: sortSizes(sizes.rows.map((r) => r.size)),
      colours: colours.rows.map((r) => ({ name: r.name, hex: r.hex ?? '#000000' })),
      priceRangeKobo: [Number(range.rows[0]?.min ?? 0), Number(range.rows[0]?.max ?? 0)],
    };
  }

  async suggestCollections(q: string, limit: number): Promise<CollectionRow[]> {
    const like = `%${escapeLike(q)}%`;
    return this.db
      .select()
      .from(collections)
      .where(sql`(${collections.name} ILIKE ${like} OR word_similarity(${q}, ${collections.name}) > 0.4)`)
      .orderBy(sql`word_similarity(${q}, ${collections.name}) DESC`)
      .limit(limit);
  }
}

const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', 'ONE SIZE', 'OS'];

export function sortSizes(sizes: string[]): string[] {
  const rank = (s: string) => {
    const i = SIZE_ORDER.indexOf(s.toUpperCase());
    if (i >= 0) return i;
    const n = parseFloat(s.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? 100 + n : 1000;
  };
  return [...new Set(sizes)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** Maps a raw snake_case variant row (from db.execute) into the typed shape. */
export function mapVariantRow(r: Record<string, unknown>): VariantWithAvailability {
  return {
    id: String(r.id),
    productId: String(r.product_id),
    sku: String(r.sku),
    colour: (r.colour as string | null) ?? null,
    colourHex: (r.colour_hex as string | null) ?? null,
    size: (r.size as string | null) ?? null,
    priceKobo: Number(r.price_kobo),
    compareAtKobo: r.compare_at_kobo === null || r.compare_at_kobo === undefined ? null : Number(r.compare_at_kobo),
    stock: Number(r.stock),
    position: Number(r.position),
    archived: Boolean(r.archived),
    createdAt: new Date(r.created_at as string),
    updatedAt: new Date(r.updated_at as string),
    available: Number(r.available),
  };
}

