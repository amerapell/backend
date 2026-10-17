import { diffVariantMatrix, generateVariantMatrix, skuFor } from '../src/catalogue/variant-matrix';
import { computeBadge, isExchangeable, isScheduled, ProductAggregate, toProductCard, variantImageUrls } from '../src/catalogue/product-presenter';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { sortSizes } from '../src/catalogue/catalogue.repository';
import type { CatalogueRepository } from '../src/catalogue/catalogue.repository';
import { StockNotifyService } from '../src/catalogue/stock-notify';
import type { CollectionRow, ProductImageRow, ProductRow } from '../src/db/schema';

const black = { name: 'Black', hex: '#16161a' };
const tan = { name: 'Tan', hex: '#b07a4a' };
const burgundy = { name: 'Burgundy', hex: '#6b1f2a' };

describe('variant matrix (ADM-1, PDP-2)', () => {
  it('generates sizes × colours, colour-major', () => {
    const m = generateVariantMatrix({ productNumber: 'No. 014', colours: [black, tan, burgundy], sizes: ['XS', 'S', 'M', 'L', 'XL'], priceKobo: 18_500_000, compareAtKobo: null });
    expect(m).toHaveLength(15);
    expect(m[0]).toEqual({ sku: 'AP-014-BLA-XS', colour: 'Black', colourHex: '#16161a', size: 'XS', priceKobo: 18_500_000, compareAtKobo: null, position: 0 });
    expect(m[14]).toMatchObject({ sku: 'AP-014-BUR-XL', colour: 'Burgundy', size: 'XL', position: 14 });
    expect(new Set(m.map((v) => v.sku)).size).toBe(15);
  });
  it('only sizes, only colours, or neither', () => {
    expect(generateVariantMatrix({ productNumber: 'No. 047', colours: [], sizes: ['EU 38', 'EU 39'], priceKobo: 1, compareAtKobo: null }).map((v) => v.sku)).toEqual([
      'AP-047-EU38',
      'AP-047-EU39',
    ]);
    expect(generateVariantMatrix({ productNumber: 'No. 031', colours: [tan], sizes: [], priceKobo: 1, compareAtKobo: null }).map((v) => v.sku)).toEqual(['AP-031-TAN']);
    const single = generateVariantMatrix({ productNumber: 'No. 080', colours: [], sizes: [], priceKobo: 3_500_000, compareAtKobo: 4_000_000 });
    expect(single).toEqual([{ sku: 'AP-080', colour: null, colourHex: null, size: null, priceKobo: 3_500_000, compareAtKobo: 4_000_000, position: 0 }]);
  });
  it('dedupes options and disambiguates colliding SKU codes', () => {
    const m = generateVariantMatrix({
      productNumber: 'No. 1',
      colours: [black, { name: 'black', hex: '#000' }, { name: 'Blank', hex: '#fff' }],
      sizes: ['M', 'm', ' M '],
      priceKobo: 1,
      compareAtKobo: null,
    });
    expect(m.map((v) => v.sku)).toEqual(['AP-1-BLA-M', 'AP-1-BLA-M2']);
  });
  it('sku helper', () => {
    expect(skuFor('No. 022', 'Ivory', 'L')).toBe('AP-022-IVO-L');
  });
  it('diff keeps surviving variants (stock preserved), creates new, archives removed', () => {
    const existing = [
      { id: 'v1', colour: 'Black', size: 'S', archived: false },
      { id: 'v2', colour: 'Black', size: 'M', archived: false },
      { id: 'v3', colour: 'Tan', size: 'S', archived: true },
    ];
    const desired = generateVariantMatrix({ productNumber: 'No. 9', colours: [black, tan], sizes: ['S', 'L'], priceKobo: 1, compareAtKobo: null });
    const diff = diffVariantMatrix(existing, desired);
    expect(diff.keep.map((k) => k.id).sort()).toEqual(['v1', 'v3']);
    expect(diff.create.map((c) => `${c.colour}/${c.size}`)).toEqual(['Black/L', 'Tan/L']);
    expect(diff.archive).toEqual(['v2']);
  });
});

const product = (over: Partial<ProductRow> = {}): ProductRow => ({
  id: 'p1',
  slug: 'cropped-leather-jacket',
  number: 'No. 014',
  name: 'Cropped leather jacket',
  material: 'Lamb leather · Outerwear',
  description: 'd',
  details: null,
  care: null,
  sizeGuide: 'CLOTHING',
  exchangeable: true,
  featured: false,
  status: 'LIVE',
  options: { colours: [black], sizes: ['S', 'M'] },
  basePriceKobo: 18_500_000,
  compareAtKobo: null,
  lowStockThreshold: 3,
  seoTitle: null,
  seoDescription: null,
  createdAt: new Date('2026-06-01'),
  updatedAt: new Date('2026-06-01'),
  ...over,
});
const variant = (id: string, available: number, over: Record<string, unknown> = {}) => ({
  id,
  productId: 'p1',
  sku: id,
  colour: 'Black',
  colourHex: '#16161a',
  size: 'M',
  priceKobo: 18_500_000,
  compareAtKobo: null,
  stock: available,
  position: 0,
  archived: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  available,
  ...over,
});
const collection = (slug: string, over: Partial<CollectionRow> = {}): CollectionRow => ({
  id: slug,
  slug,
  name: slug,
  description: null,
  isDrop: false,
  goLiveAt: null,
  heroPattern: null,
  heroImageUrl: null,
  homeOrder: null,
  tagline: null,
  exchangeable: true,
  sortOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});
const agg = (over: Partial<ProductAggregate> = {}): ProductAggregate => ({ product: product(), variants: [variant('a', 5), variant('b', 5)], images: [], collections: [], ...over });
const now = new Date('2026-10-13T12:00:00Z');

describe('product badges (CAT-2)', () => {
  it('SOLD_OUT when nothing is available (holds count against stock)', () => {
    expect(computeBadge(agg({ variants: [variant('a', 0), variant('b', -1)] }), now)).toEqual({ badge: 'SOLD_OUT', lowStockCount: null });
  });
  it('LOW_STOCK with count at or below threshold ("Only 2 left")', () => {
    expect(computeBadge(agg({ variants: [variant('a', 2)] }), now)).toEqual({ badge: 'LOW_STOCK', lowStockCount: 2 });
  });
  it('SALE when the display variant has a higher compare-at', () => {
    expect(computeBadge(agg({ variants: [variant('a', 9, { priceKobo: 6_250_000, compareAtKobo: 7_800_000 })] }), now).badge).toBe('SALE');
  });
  it('DROP when in a drop collection; NEW when in New In or recently created', () => {
    expect(computeBadge(agg({ collections: [collection('drop', { isDrop: true })] }), now).badge).toBe('DROP');
    expect(computeBadge(agg({ collections: [collection('new-in')] }), now).badge).toBe('NEW');
    expect(computeBadge(agg({ product: product({ createdAt: new Date('2026-10-10') }) }), now).badge).toBe('NEW');
    expect(computeBadge(agg(), now).badge).toBeNull();
  });
  it('ignores archived variants', () => {
    expect(computeBadge(agg({ variants: [variant('a', 10, { archived: true })] }), now).badge).toBe('SOLD_OUT');
  });
  it('builds a card with the cheapest in-stock price', () => {
    const card = toProductCard(
      agg({ variants: [variant('a', 0, { priceKobo: 100 }), variant('b', 9, { priceKobo: 200 }), variant('c', 9, { priceKobo: 300 })] }),
      now,
    );
    expect(card.priceKobo).toBe(200);
    expect(card.inStock).toBe(true);
    expect(card.colours).toEqual([black]);
  });
  it('scheduled drops are hidden until go-live; collection-level exchangeability (EXC-2)', () => {
    expect(isScheduled({ collections: [collection('d', { isDrop: true, goLiveAt: new Date('2026-10-14') })] }, now)).toBe(true);
    expect(isScheduled({ collections: [collection('d', { isDrop: true, goLiveAt: new Date('2026-10-12') })] }, now)).toBe(false);
    expect(isExchangeable({ product: product(), collections: [collection('jewellery', { exchangeable: false })] })).toBe(false);
    expect(isExchangeable({ product: product({ exchangeable: false }), collections: [] })).toBe(false);
  });
  it('colour swatches swap the gallery (PDP-3)', () => {
    const img = (url: string, colour: string | null, sortOrder: number) => ({ id: url, productId: 'p1', url, alt: '', colour, sortOrder }) as ProductImageRow;
    const images = [img('tan1', 'Tan', 2), img('black1', 'Black', 0), img('black2', 'Black', 1), img('any', null, 3)];
    expect(variantImageUrls(images, 'Black')).toEqual(['black1', 'black2']);
    expect(variantImageUrls(images, 'Burgundy')).toEqual(['any']);
    expect(variantImageUrls(images, null)).toEqual(['any']);
  });
  it('sorts sizes sensibly', () => {
    expect(sortSizes(['XL', 'S', 'EU 40', 'M', 'EU 38', 'XS'])).toEqual(['XS', 'S', 'M', 'XL', 'EU 38', 'EU 40']);
  });
});

describe('featured piece + stock notify', () => {
  it('exposes the admin featured flag on cards', () => {
    expect(toProductCard(agg(), now).featured).toBe(false);
    expect(toProductCard(agg({ product: product({ featured: true }) }), now).featured).toBe(true);
  });

  const setup = (a: ProductAggregate | null) => {
    const added: { email: string; productId: string; variantId: string }[] = [];
    const catalogue = {
      findProductIdBySlug: async (slug: string) => (a && slug === a.product.slug ? a.product.id : null),
      loadAggregates: async () => (a ? [a] : []),
    } as unknown as CatalogueRepository;
    const svc = new StockNotifyService(catalogue, { add: async (e) => void added.push(e) }, { now: () => now });
    return { svc, added };
  };
  it('stores a normalised sign-up for a variant of the product', async () => {
    const { svc, added } = setup(agg());
    await expect(svc.subscribe('cropped-leather-jacket', ' Ada@Example.com ', 'b')).resolves.toEqual({ ok: true });
    expect(added).toEqual([{ email: 'ada@example.com', productId: 'p1', variantId: 'b' }]);
  });
  it('rejects unknown products and variants', async () => {
    await expect(setup(agg()).svc.subscribe('nope', 'a@b.co', 'a')).rejects.toBeInstanceOf(NotFoundException);
    await expect(setup(agg()).svc.subscribe('cropped-leather-jacket', 'a@b.co', 'zzz')).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup(agg({ product: product({ status: 'DRAFT' }) })).svc.subscribe('cropped-leather-jacket', 'a@b.co', 'a')).rejects.toBeInstanceOf(NotFoundException);
  });
});
