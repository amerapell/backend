import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/database.module';
import { collections, productCollections, productImages, products, stockHolds, variants } from '../../db/schema';
import type { CollectionRow, ProductRow, VariantRow } from '../../db/schema';
import type { MatrixVariant } from '../../catalogue/variant-matrix';

export const ADMIN_PRODUCTS_REPOSITORY = Symbol('ADMIN_PRODUCTS_REPOSITORY');

export type ProductFields = Omit<ProductRow, 'id' | 'createdAt' | 'updatedAt'>;
export type ImageInput = { url: string; alt: string; colour?: string | null; scale?: number };

export interface VariantChanges {
  keep: { id: string; colourHex: string | null; position: number }[];
  create: (MatrixVariant & { stock: number })[];
  archive: string[];
  /** Re-price variants still on the old base price/compare-at. */
  reprice?: { fromPrice: number; toPrice: number; fromCompareAt: number | null; toCompareAt: number | null };
}

export interface AdminProductsRepository {
  slugTaken(slug: string, excludeId?: string): Promise<boolean>;
  existingSkus(skus: string[]): Promise<Set<string>>;
  create(fields: ProductFields, collectionIds: string[], images: ImageInput[], variants: (MatrixVariant & { stock: number })[]): Promise<string>;
  update(id: string, fields: Partial<ProductFields>, collectionIds?: string[], images?: ImageInput[], changes?: VariantChanges): Promise<void>;
  findProduct(id: string): Promise<ProductRow | null>;
  /** Removes the product, its variants, images and collection links. 'held' (nothing deleted) while a checkout holds its stock. */
  deletePermanently(id: string, now: Date): Promise<'deleted' | 'held'>;
  variantsOf(productId: string): Promise<VariantRow[]>;
  findVariant(id: string): Promise<VariantRow | null>;
  updateVariant(id: string, patch: Partial<Pick<VariantRow, 'priceKobo' | 'compareAtKobo' | 'stock' | 'sku'>>): Promise<VariantRow | null>;
  stockRows(): Promise<{ sku: string; product: string; colour: string | null; size: string | null; stock: number }[]>;
  setStock(updates: { sku: string; stock: number }[]): Promise<{ updated: number; missing: string[] }>;
  collections(): Promise<(CollectionRow & { productCount: number })[]>;
  findCollection(id: string): Promise<CollectionRow | null>;
  collectionSlugTaken(slug: string, excludeId?: string): Promise<boolean>;
  createCollection(data: Omit<CollectionRow, 'id' | 'createdAt' | 'updatedAt'>): Promise<CollectionRow>;
  updateCollection(id: string, data: Partial<Omit<CollectionRow, 'id' | 'createdAt' | 'updatedAt'>>): Promise<CollectionRow | null>;
  deleteCollection(id: string): Promise<boolean>;
  existingCollectionIds(ids: string[]): Promise<string[]>;
}

@Injectable()
export class DrizzleAdminProductsRepository implements AdminProductsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async slugTaken(slug: string, excludeId?: string) {
    const rows = await this.db
      .select({ id: products.id })
      .from(products)
      .where(excludeId ? and(eq(products.slug, slug), ne(products.id, excludeId)) : eq(products.slug, slug))
      .limit(1);
    return rows.length > 0;
  }

  async existingSkus(skus: string[]) {
    if (!skus.length) return new Set<string>();
    const rows = await this.db.select({ sku: variants.sku }).from(variants).where(inArray(variants.sku, skus));
    return new Set(rows.map((r) => r.sku));
  }

  async create(fields: ProductFields, collectionIds: string[], images: ImageInput[], vs: (MatrixVariant & { stock: number })[]) {
    return this.db.transaction(async (tx) => {
      const [p] = await tx.insert(products).values(fields).returning({ id: products.id });
      if (collectionIds.length) await tx.insert(productCollections).values(collectionIds.map((collectionId) => ({ productId: p.id, collectionId })));
      if (images.length) {
        await tx.insert(productImages).values(images.map((i, n) => ({ productId: p.id, url: i.url, alt: i.alt, colour: i.colour ?? null, sortOrder: n, scale: i.scale ?? 100 })));
      }
      if (vs.length) await tx.insert(variants).values(vs.map((v) => ({ ...v, productId: p.id })));
      return p.id;
    });
  }

  async update(id: string, fields: Partial<ProductFields>, collectionIds?: string[], images?: ImageInput[], changes?: VariantChanges) {
    await this.db.transaction(async (tx) => {
      if (Object.keys(fields).length) await tx.update(products).set(fields).where(eq(products.id, id));
      if (collectionIds) {
        await tx.delete(productCollections).where(eq(productCollections.productId, id));
        if (collectionIds.length) await tx.insert(productCollections).values(collectionIds.map((collectionId) => ({ productId: id, collectionId })));
      }
      if (images) {
        await tx.delete(productImages).where(eq(productImages.productId, id));
        if (images.length) {
          await tx.insert(productImages).values(images.map((i, n) => ({ productId: id, url: i.url, alt: i.alt, colour: i.colour ?? null, sortOrder: n, scale: i.scale ?? 100 })));
        }
      }
      if (changes) {
        if (changes.reprice) {
          const r = changes.reprice;
          if (r.fromPrice !== r.toPrice) {
            await tx.update(variants).set({ priceKobo: r.toPrice }).where(and(eq(variants.productId, id), eq(variants.priceKobo, r.fromPrice)));
          }
          if (r.fromCompareAt !== r.toCompareAt) {
            await tx
              .update(variants)
              .set({ compareAtKobo: r.toCompareAt })
              .where(
                and(
                  eq(variants.productId, id),
                  r.fromCompareAt === null ? sql`${variants.compareAtKobo} IS NULL` : eq(variants.compareAtKobo, r.fromCompareAt),
                ),
              );
          }
        }
        for (const k of changes.keep) {
          await tx.update(variants).set({ colourHex: k.colourHex, position: k.position, archived: false }).where(eq(variants.id, k.id));
        }
        if (changes.archive.length) await tx.update(variants).set({ archived: true }).where(inArray(variants.id, changes.archive));
        if (changes.create.length) await tx.insert(variants).values(changes.create.map((v) => ({ ...v, productId: id })));
      }
      await tx.update(products).set({ updatedAt: new Date() }).where(eq(products.id, id));
    });
  }

  async deletePermanently(id: string, now: Date): Promise<'deleted' | 'held'> {
    return this.db.transaction(async (tx) => {
      const [held] = await tx
        .select({ id: stockHolds.id })
        .from(stockHolds)
        .innerJoin(variants, eq(variants.id, stockHolds.variantId))
        .where(and(eq(variants.productId, id), isNull(stockHolds.releasedAt), isNull(stockHolds.consumedAt), gt(stockHolds.expiresAt, now)))
        .limit(1);
      if (held) return 'held';
      // Variants, images, collection links, holds, carts and notify-me requests cascade; past order lines keep
      // their own copy of the name, SKU and photo (their product/variant links are set to null).
      await tx.delete(products).where(eq(products.id, id));
      return 'deleted';
    });
  }

  async findProduct(id: string) {
    const [r] = await this.db.select().from(products).where(eq(products.id, id)).limit(1);
    return r ?? null;
  }

  variantsOf(productId: string) {
    return this.db.select().from(variants).where(eq(variants.productId, productId)).orderBy(asc(variants.position));
  }

  async findVariant(id: string) {
    const [r] = await this.db.select().from(variants).where(eq(variants.id, id)).limit(1);
    return r ?? null;
  }

  async updateVariant(id: string, patch: Partial<Pick<VariantRow, 'priceKobo' | 'compareAtKobo' | 'stock' | 'sku'>>) {
    const [r] = await this.db.update(variants).set(patch).where(eq(variants.id, id)).returning();
    return r ?? null;
  }

  async stockRows() {
    return this.db
      .select({ sku: variants.sku, product: products.name, colour: variants.colour, size: variants.size, stock: variants.stock })
      .from(variants)
      .innerJoin(products, eq(products.id, variants.productId))
      .where(and(eq(variants.archived, false), ne(products.status, 'ARCHIVED')))
      .orderBy(asc(products.number), asc(variants.position));
  }

  async setStock(updates: { sku: string; stock: number }[]) {
    return this.db.transaction(async (tx) => {
      let updated = 0;
      const missing: string[] = [];
      for (const u of updates) {
        const r = await tx.update(variants).set({ stock: u.stock }).where(eq(variants.sku, u.sku)).returning({ id: variants.id });
        if (r.length) updated++;
        else missing.push(u.sku);
      }
      return { updated, missing };
    });
  }

  async collections() {
    const rows = await this.db
      .select({ c: collections, productCount: sql<number>`(SELECT COUNT(*)::int FROM product_collections pc WHERE pc.collection_id = ${collections.id})` })
      .from(collections)
      .orderBy(asc(collections.sortOrder), asc(collections.name));
    return rows.map((r) => ({ ...r.c, productCount: Number(r.productCount) }));
  }

  async findCollection(id: string) {
    const [r] = await this.db.select().from(collections).where(eq(collections.id, id)).limit(1);
    return r ?? null;
  }

  async collectionSlugTaken(slug: string, excludeId?: string) {
    const rows = await this.db
      .select({ id: collections.id })
      .from(collections)
      .where(excludeId ? and(eq(collections.slug, slug), ne(collections.id, excludeId)) : eq(collections.slug, slug))
      .limit(1);
    return rows.length > 0;
  }

  async createCollection(data: Omit<CollectionRow, 'id' | 'createdAt' | 'updatedAt'>) {
    const [r] = await this.db.insert(collections).values(data).returning();
    return r;
  }

  async updateCollection(id: string, data: Partial<Omit<CollectionRow, 'id' | 'createdAt' | 'updatedAt'>>) {
    const [r] = await this.db.update(collections).set(data).where(eq(collections.id, id)).returning();
    return r ?? null;
  }

  async deleteCollection(id: string) {
    const r = await this.db.delete(collections).where(eq(collections.id, id)).returning({ id: collections.id });
    return r.length > 0;
  }

  async existingCollectionIds(ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.db.select({ id: collections.id }).from(collections).where(inArray(collections.id, ids));
    return rows.map((r) => r.id);
  }
}
