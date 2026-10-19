import type { Badge, Collection, Colour, Product, ProductCard, Variant } from '../common/contract';
import type { CollectionRow, ProductImageRow, ProductRow, VariantRow } from '../db/schema';

export const NEW_IN_SLUG = 'new-in';
export const SALE_SLUG = 'sale';
const NEW_WINDOW_DAYS = 30;

export type VariantWithAvailability = VariantRow & { available: number };

/** Everything needed to present a product, loaded by the catalogue repository. */
export interface ProductAggregate {
  product: ProductRow;
  variants: VariantWithAvailability[];
  images: ProductImageRow[];
  collections: CollectionRow[];
}

export function activeVariants(agg: ProductAggregate): VariantWithAvailability[] {
  return agg.variants.filter((v) => !v.archived).sort((a, b) => a.position - b.position);
}

export function totalAvailable(agg: ProductAggregate): number {
  return activeVariants(agg).reduce((n, v) => n + Math.max(0, v.available), 0);
}

/** A product inside a drop collection whose go-live time is still in the future is not yet public (CAT-5). */
export function isScheduled(agg: Pick<ProductAggregate, 'collections'>, now: Date): boolean {
  return agg.collections.some((c) => c.isDrop && c.goLiveAt !== null && c.goLiveAt.getTime() > now.getTime());
}

/** EXC-2: not exchangeable if the product or any of its collections is marked not exchangeable. */
export function isExchangeable(agg: Pick<ProductAggregate, 'product' | 'collections'>): boolean {
  return agg.product.exchangeable && agg.collections.every((c) => c.exchangeable);
}

/** The variant whose price represents the product on cards: cheapest in-stock, else cheapest overall. */
export function displayVariant(agg: ProductAggregate): VariantWithAvailability | null {
  const vs = activeVariants(agg);
  if (!vs.length) return null;
  const inStock = vs.filter((v) => v.available > 0);
  const pool = inStock.length ? inStock : vs;
  return pool.reduce((min, v) => (v.priceKobo < min.priceKobo ? v : min), pool[0]);
}

/**
 * CAT-2 badge precedence: SOLD_OUT > LOW_STOCK ("Only N left") > SALE > DROP > NEW.
 */
export function computeBadge(agg: ProductAggregate, now: Date): { badge: Badge | null; lowStockCount: number | null } {
  const available = totalAvailable(agg);
  if (activeVariants(agg).length === 0 || available <= 0) return { badge: 'SOLD_OUT', lowStockCount: null };
  if (available <= agg.product.lowStockThreshold) return { badge: 'LOW_STOCK', lowStockCount: available };
  const dv = displayVariant(agg);
  if (dv && dv.compareAtKobo !== null && dv.compareAtKobo > dv.priceKobo) return { badge: 'SALE', lowStockCount: null };
  if (agg.collections.some((c) => c.isDrop)) return { badge: 'DROP', lowStockCount: null };
  const recent = now.getTime() - agg.product.createdAt.getTime() < NEW_WINDOW_DAYS * 86_400_000;
  if (agg.collections.some((c) => c.slug === NEW_IN_SLUG) || recent) return { badge: 'NEW', lowStockCount: null };
  return { badge: null, lowStockCount: null };
}

export function productColours(agg: ProductAggregate): Colour[] {
  const declared = agg.product.options?.colours ?? [];
  if (declared.length) return declared;
  const seen = new Map<string, Colour>();
  for (const v of activeVariants(agg)) {
    if (v.colour && !seen.has(v.colour)) seen.set(v.colour, { name: v.colour, hex: v.colourHex ?? '#000000' });
  }
  return [...seen.values()];
}

function sortedImages(agg: ProductAggregate): ProductImageRow[] {
  return [...agg.images].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function variantImageUrls(images: ProductImageRow[], colour: string | null): string[] {
  const sorted = [...images].sort((a, b) => a.sortOrder - b.sortOrder);
  if (colour) {
    const own = sorted.filter((i) => i.colour?.toLowerCase() === colour.toLowerCase());
    if (own.length) return own.map((i) => i.url);
  }
  const neutral = sorted.filter((i) => !i.colour);
  return (neutral.length ? neutral : sorted).map((i) => i.url);
}

export function toProductCard(agg: ProductAggregate, now: Date): ProductCard {
  const p = agg.product;
  const dv = displayVariant(agg);
  const { badge, lowStockCount } = computeBadge(agg, now);
  const priceKobo = dv?.priceKobo ?? p.basePriceKobo;
  const compareAt = dv ? dv.compareAtKobo : p.compareAtKobo;
  return {
    id: p.id,
    slug: p.slug,
    number: p.number,
    name: p.name,
    material: p.material,
    priceKobo,
    compareAtKobo: compareAt !== null && compareAt > priceKobo ? compareAt : null,
    badge,
    lowStockCount,
    images: sortedImages(agg)
      .slice(0, 4)
      .map((i) => ({ url: i.url, alt: i.alt || p.name, scale: i.scale ?? 100 })),
    colours: productColours(agg),
    inStock: totalAvailable(agg) > 0,
    featured: p.featured,
  };
}

export function toVariant(v: VariantWithAvailability, images: ProductImageRow[]): Variant {
  return {
    id: v.id,
    sku: v.sku,
    colour: v.colour,
    colourHex: v.colourHex,
    size: v.size,
    priceKobo: v.priceKobo,
    compareAtKobo: v.compareAtKobo,
    stock: v.stock,
    available: Math.max(0, v.available),
    imageUrls: variantImageUrls(images, v.colour),
  };
}

export function toProduct(agg: ProductAggregate, related: ProductCard[], now: Date): Product {
  const p = agg.product;
  const card = toProductCard(agg, now);
  const images = sortedImages(agg);
  const sizes = p.options?.sizes?.length
    ? p.options.sizes
    : [...new Set(activeVariants(agg).map((v) => v.size).filter((s): s is string => !!s))];
  const plain = (p.seoDescription ?? p.description).replace(/\s+/g, ' ').trim();
  return {
    ...card,
    images: images.map((i) => ({ url: i.url, alt: i.alt || p.name, scale: i.scale ?? 100 })),
    description: p.description,
    details: p.details,
    care: p.care,
    sizeGuide: p.sizeGuide,
    exchangeable: isExchangeable(agg),
    options: { colours: productColours(agg), sizes },
    variants: activeVariants(agg).map((v) => toVariant(v, agg.images)),
    collections: [...agg.collections]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((c) => ({ slug: c.slug, name: c.name })),
    related,
    seo: {
      title: p.seoTitle ?? `${p.name} — Amerapelle`,
      description: plain.length > 155 ? plain.slice(0, 152).trimEnd() + '…' : plain,
      ogImage: images[0]?.url ?? null,
    },
  };
}

export function toCollection(c: CollectionRow, count: number): Collection {
  return {
    id: c.id,
    slug: c.slug,
    name: c.name,
    description: c.description,
    count,
    isDrop: c.isDrop,
    goLiveAt: c.goLiveAt ? c.goLiveAt.toISOString() : null,
    heroPattern: c.heroPattern ?? null,
    heroImageUrl: c.heroImageUrl ?? null,
    homeOrder: c.homeOrder ?? null,
    tagline: c.tagline ?? null,
  };
}
