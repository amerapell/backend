import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminProductsService, cleanText } from '../src/admin/products/admin-products.service';
import { CollectionDto, UpdateCollectionDto } from '../src/admin/products/admin-products.dto';
import type { AdminProductsRepository } from '../src/admin/products/admin-products.repository';
import type { CatalogueRepository } from '../src/catalogue/catalogue.repository';
import { toCollection } from '../src/catalogue/product-presenter';
import type { CollectionRow } from '../src/db/schema';
import type { SettingsService } from '../src/settings/settings.service';

/* Design v3 §8 — collections carry heroImageUrl, homeOrder and tagline for the home hero panels. */

const row = (over: Partial<CollectionRow> = {}): CollectionRow => ({
  id: 'col_1',
  slug: 'women',
  name: 'Women',
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

function makeService() {
  const store = new Map<string, CollectionRow>();
  const repo = {
    collectionSlugTaken: async () => false,
    createCollection: async (data: Omit<CollectionRow, 'id' | 'createdAt' | 'updatedAt'>) => {
      const r = row({ ...data, id: `col_${store.size + 1}` });
      store.set(r.id, r);
      return r;
    },
    findCollection: async (id: string) => store.get(id) ?? null,
    updateCollection: async (id: string, data: Partial<CollectionRow>) => {
      const cur = store.get(id);
      if (!cur) return null;
      const next = { ...cur, ...data };
      store.set(id, next);
      return next;
    },
  } as unknown as AdminProductsRepository;
  const settings = { invalidate: () => undefined } as unknown as SettingsService;
  const clock = { now: () => new Date('2026-10-16T09:00:00Z') };
  const service = new AdminProductsService(repo, {} as CatalogueRepository, clock, settings);
  return { service, store };
}

describe('collection hero fields', () => {
  it('public presenter exposes heroImageUrl, homeOrder and tagline (null when unset)', () => {
    expect(toCollection(row(), 3)).toMatchObject({ heroImageUrl: null, homeOrder: null, tagline: null, count: 3 });
    const c = toCollection(row({ heroImageUrl: '/media/abc', homeOrder: 2, tagline: 'Discover the collection' }), 0);
    expect(c.heroImageUrl).toBe('/media/abc');
    expect(c.homeOrder).toBe(2);
    expect(c.tagline).toBe('Discover the collection');
  });

  it('cleanText trims and turns empty strings into null', () => {
    expect(cleanText('  Shop the edit ')).toBe('Shop the edit');
    expect(cleanText('   ')).toBeNull();
    expect(cleanText(null)).toBeNull();
    expect(cleanText(undefined)).toBeNull();
  });

  it('admin create stores the hero fields and returns them', async () => {
    const { service } = makeService();
    const out = await service.createCollection({ name: 'Women', heroImageUrl: ' /media/w1 ', homeOrder: 1, tagline: '' });
    expect(out).toMatchObject({ slug: 'women', heroImageUrl: '/media/w1', homeOrder: 1, tagline: null });
  });

  it('admin update patches only the fields sent; null clears them', async () => {
    const { service } = makeService();
    const created = await service.createCollection({ name: 'Men', heroImageUrl: '/media/m', homeOrder: 2, tagline: 'Discover' });
    const kept = await service.updateCollection(created.id, { name: 'Men' });
    expect(kept).toMatchObject({ heroImageUrl: '/media/m', homeOrder: 2, tagline: 'Discover' });
    const cleared = await service.updateCollection(created.id, { heroImageUrl: null, homeOrder: null, tagline: 'Shop men' });
    expect(cleared).toMatchObject({ heroImageUrl: null, homeOrder: null, tagline: 'Shop men' });
  });

  it('DTO validation accepts nulls and rejects bad values', async () => {
    const ok = await validate(plainToInstance(CollectionDto, { name: 'Shoes', heroImageUrl: null, homeOrder: null, tagline: null }));
    expect(ok).toHaveLength(0);
    const bad = await validate(plainToInstance(UpdateCollectionDto, { homeOrder: -1, tagline: 'x'.repeat(81), heroImageUrl: 42 }));
    expect(bad.map((e) => e.property).sort()).toEqual(['heroImageUrl', 'homeOrder', 'tagline']);
  });
});
