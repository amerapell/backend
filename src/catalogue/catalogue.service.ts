import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CLOCK, Clock } from '../common/clock';
import type { Collection, Product, ProductCard } from '../common/contract';
import { Paginated } from '../common/pagination';
import { CATALOGUE_REPOSITORY, CatalogueRepository, Facets, ProductFilter } from './catalogue.repository';
import { isScheduled, toCollection, toProduct, toProductCard } from './product-presenter';

export type ListQuery = Omit<ProductFilter, 'now'>;

@Injectable()
export class CatalogueService {
  constructor(
    @Inject(CATALOGUE_REPOSITORY) private readonly repo: CatalogueRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async listCollections(): Promise<Collection[]> {
    const rows = await this.repo.listCollections(this.clock.now());
    return rows.map((r) => toCollection(r.collection, r.count));
  }

  async listProducts(query: ListQuery): Promise<Paginated<ProductCard>> {
    const now = this.clock.now();
    const { ids, total } = await this.repo.searchProductIds({ ...query, now });
    const aggs = await this.repo.loadAggregates(ids);
    return { items: aggs.map((a) => toProductCard(a, now)), page: query.page, pageSize: query.pageSize, total };
  }

  async getCollection(slug: string, query: Omit<ListQuery, 'collectionSlug'>): Promise<{ collection: Collection; products: Paginated<ProductCard>; facets: Facets }> {
    const now = this.clock.now();
    const c = await this.repo.findCollectionBySlug(slug);
    if (!c) throw new NotFoundException('Collection not found');
    const [count, facets, page] = await Promise.all([
      this.repo.countPublicProducts(c.id, now),
      this.repo.facets(c.id, now),
      this.listProducts({ ...query, collectionSlug: slug }),
    ]);
    return { collection: toCollection(c, count), products: page, facets };
  }

  async getProduct(slug: string): Promise<Product> {
    const now = this.clock.now();
    const id = await this.repo.findProductIdBySlug(slug);
    const [agg] = id ? await this.repo.loadAggregates([id]) : [];
    if (!agg || agg.product.status !== 'LIVE' || isScheduled(agg, now)) throw new NotFoundException('Product not found');
    const relatedIds = await this.repo.relatedProductIds(
      agg.product.id,
      agg.collections.map((c) => c.id),
      4,
      now,
    );
    const related = (await this.repo.loadAggregates(relatedIds)).map((a) => toProductCard(a, now));
    return toProduct(agg, related, now);
  }

  async cardsByIds(ids: string[]): Promise<ProductCard[]> {
    const now = this.clock.now();
    const aggs = await this.repo.loadAggregates(ids);
    return aggs.filter((a) => a.product.status === 'LIVE' && !isScheduled(a, now)).map((a) => toProductCard(a, now));
  }

  async suggest(q: string): Promise<{ products: ProductCard[]; collections: Collection[] }> {
    const term = q.trim();
    if (term.length < 2) return { products: [], collections: [] };
    const now = this.clock.now();
    const [page, cols, all] = await Promise.all([
      this.listProducts({ q: term, sort: 'newest', page: 1, pageSize: 6 }),
      this.repo.suggestCollections(term, 3),
      this.repo.listCollections(now),
    ]);
    const counts = new Map(all.map((r) => [r.collection.id, r.count]));
    return { products: page.items, collections: cols.map((c) => toCollection(c, counts.get(c.id) ?? 0)) };
  }
}
