import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CLOCK, Clock } from '../../common/clock';
import type { Collection, Product, ProductStatus } from '../../common/contract';
import { slugify } from '../../common/ids';
import { parseCsv, toCsv } from '../../common/csv';
import { Paginated } from '../../common/pagination';
import { CATALOGUE_REPOSITORY, CatalogueRepository } from '../../catalogue/catalogue.repository';
import { displayVariant, toCollection, toProduct, totalAvailable } from '../../catalogue/product-presenter';
import { diffVariantMatrix, generateVariantMatrix, MatrixVariant } from '../../catalogue/variant-matrix';
import { SettingsService } from '../../settings/settings.service';
import { ADMIN_PRODUCTS_REPOSITORY, AdminProductsRepository, ProductFields } from './admin-products.repository';
import { CollectionDto, CreateProductDto, UpdateCollectionDto, UpdateProductDto, UpdateVariantDto } from './admin-products.dto';

export interface AdminProductSummary {
  id: string;
  slug: string;
  number: string;
  name: string;
  status: ProductStatus;
  priceKobo: number;
  stock: number;
  available: number;
  variantCount: number;
  imageUrl: string | null;
  updatedAt: string;
}

export type AdminProduct = Product & {
  status: ProductStatus;
  basePriceKobo: number;
  lowStockThreshold: number;
  collectionIds: string[];
  seoTitle: string | null;
  seoDescription: string | null;
  imagesDetailed: { id: string; url: string; alt: string; colour: string | null; scale: number }[];
};

/** ADM-1/ADM-2: product CRUD with variant matrix generation, archive, stock CSV. */
@Injectable()
export class AdminProductsService {
  constructor(
    @Inject(ADMIN_PRODUCTS_REPOSITORY) private readonly repo: AdminProductsRepository,
    @Inject(CATALOGUE_REPOSITORY) private readonly catalogue: CatalogueRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly settings: SettingsService,
  ) {}

  async list(q: string | undefined, status: ProductStatus | undefined, page: number, pageSize: number): Promise<Paginated<AdminProductSummary>> {
    const statuses: ProductStatus[] = status ? [status] : ['DRAFT', 'LIVE', 'ARCHIVED'];
    const { ids, total } = await this.catalogue.searchProductIds({ q, statuses, sort: 'newest', page, pageSize, now: this.clock.now() });
    const aggs = await this.catalogue.loadAggregates(ids);
    return {
      items: aggs.map((a) => {
        const active = a.variants.filter((v) => !v.archived);
        return {
          id: a.product.id,
          slug: a.product.slug,
          number: a.product.number,
          name: a.product.name,
          status: a.product.status,
          priceKobo: displayVariant(a)?.priceKobo ?? a.product.basePriceKobo,
          stock: active.reduce((n, v) => n + v.stock, 0),
          available: totalAvailable(a),
          variantCount: active.length,
          imageUrl: [...a.images].sort((x, y) => x.sortOrder - y.sortOrder)[0]?.url ?? null,
          updatedAt: a.product.updatedAt.toISOString(),
        };
      }),
      page,
      pageSize,
      total,
    };
  }

  async get(id: string): Promise<AdminProduct> {
    const [agg] = await this.catalogue.loadAggregates([id]);
    if (!agg) throw new NotFoundException('Product not found');
    const p = agg.product;
    return {
      ...toProduct(agg, [], this.clock.now()),
      status: p.status,
      basePriceKobo: p.basePriceKobo,
      lowStockThreshold: p.lowStockThreshold,
      collectionIds: agg.collections.map((c) => c.id),
      seoTitle: p.seoTitle,
      seoDescription: p.seoDescription,
      imagesDetailed: [...agg.images].sort((a, b) => a.sortOrder - b.sortOrder).map((i) => ({ id: i.id, url: i.url, alt: i.alt, colour: i.colour, scale: i.scale })),
    };
  }

  private async uniqueSlug(base: string, excludeId?: string): Promise<string> {
    const root = slugify(base) || 'product';
    let slug = root;
    for (let n = 2; await this.repo.slugTaken(slug, excludeId); n++) slug = `${root}-${n}`;
    return slug;
  }

  /** Makes generated SKUs unique against the database (and each other). */
  private async uniqueSkus(vs: MatrixVariant[]): Promise<MatrixVariant[]> {
    const taken = await this.repo.existingSkus(vs.map((v) => v.sku));
    const used = new Set<string>();
    return vs.map((v) => {
      let sku = v.sku;
      for (let n = 2; taken.has(sku) || used.has(sku); n++) sku = `${v.sku}-${n}`;
      used.add(sku);
      return { ...v, sku };
    });
  }

  private async validCollections(ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    const found = await this.repo.existingCollectionIds(unique);
    if (found.length !== unique.length) throw new BadRequestException('One or more collections do not exist');
    return unique;
  }

  async create(dto: CreateProductDto): Promise<AdminProduct> {
    if (dto.compareAtKobo != null && dto.compareAtKobo <= dto.basePriceKobo) throw new BadRequestException('compareAtKobo must be greater than the price');
    const slug = await this.uniqueSlug(dto.slug || dto.name);
    const collectionIds = await this.validCollections(dto.collectionIds);
    const matrix = await this.uniqueSkus(
      generateVariantMatrix({ productNumber: dto.number, colours: dto.colours, sizes: dto.sizes, priceKobo: dto.basePriceKobo, compareAtKobo: dto.compareAtKobo ?? null }),
    );
    const fields: ProductFields = {
      slug,
      number: dto.number.trim(),
      name: dto.name.trim(),
      material: dto.material ?? null,
      description: dto.description,
      details: dto.details ?? null,
      care: dto.care ?? null,
      sizeGuide: dto.sizeGuide,
      exchangeable: dto.exchangeable,
      featured: dto.featured ?? false,
      status: dto.status,
      options: { colours: dto.colours, sizes: dto.sizes },
      basePriceKobo: dto.basePriceKobo,
      compareAtKobo: dto.compareAtKobo ?? null,
      lowStockThreshold: dto.lowStockThreshold ?? 3,
      seoTitle: dto.seoTitle ?? null,
      seoDescription: dto.seoDescription ?? null,
    };
    const id = await this.repo.create(
      fields,
      collectionIds,
      dto.images,
      matrix.map((v) => ({ ...v, stock: dto.initialStock ?? 0 })),
    );
    return this.get(id);
  }

  async update(id: string, dto: UpdateProductDto): Promise<AdminProduct> {
    const current = await this.repo.findProduct(id);
    if (!current) throw new NotFoundException('Product not found');
    const fields: Partial<ProductFields> = {};
    const assign = <K extends keyof ProductFields>(k: K, v: ProductFields[K] | undefined) => {
      if (v !== undefined) fields[k] = v;
    };
    assign('name', dto.name?.trim());
    assign('number', dto.number?.trim());
    assign('material', dto.material);
    assign('description', dto.description);
    assign('details', dto.details);
    assign('care', dto.care);
    assign('sizeGuide', dto.sizeGuide);
    assign('exchangeable', dto.exchangeable);
    assign('featured', dto.featured);
    assign('status', dto.status);
    assign('lowStockThreshold', dto.lowStockThreshold);
    assign('seoTitle', dto.seoTitle);
    assign('seoDescription', dto.seoDescription);
    if (dto.slug !== undefined && slugify(dto.slug) !== current.slug) fields.slug = await this.uniqueSlug(dto.slug, id);

    const price = dto.basePriceKobo ?? current.basePriceKobo;
    const compareAt = dto.compareAtKobo !== undefined ? dto.compareAtKobo : current.compareAtKobo;
    if (compareAt !== null && compareAt <= price) throw new BadRequestException('compareAtKobo must be greater than the price');
    assign('basePriceKobo', dto.basePriceKobo);
    if (dto.compareAtKobo !== undefined) fields.compareAtKobo = dto.compareAtKobo;

    const optionsChanged = dto.colours !== undefined || dto.sizes !== undefined;
    const priceChanged = price !== current.basePriceKobo || compareAt !== current.compareAtKobo;
    let changes;
    if (optionsChanged || priceChanged) {
      const colours = dto.colours ?? current.options.colours;
      const sizes = dto.sizes ?? current.options.sizes;
      fields.options = { colours, sizes };
      const desired = generateVariantMatrix({ productNumber: dto.number ?? current.number, colours, sizes, priceKobo: price, compareAtKobo: compareAt });
      const existing = await this.repo.variantsOf(id);
      const diff = diffVariantMatrix(existing, desired);
      changes = {
        keep: diff.keep.map((k) => ({ id: k.id, colourHex: k.desired.colourHex, position: k.desired.position })),
        create: (await this.uniqueSkus(diff.create)).map((v) => ({ ...v, stock: dto.initialStock ?? 0 })),
        archive: diff.archive,
        reprice: priceChanged
          ? { fromPrice: current.basePriceKobo, toPrice: price, fromCompareAt: current.compareAtKobo, toCompareAt: compareAt }
          : undefined,
      };
    }
    const collectionIds = dto.collectionIds ? await this.validCollections(dto.collectionIds) : undefined;
    await this.repo.update(id, fields, collectionIds, dto.images, changes);
    return this.get(id);
  }

  async archive(id: string): Promise<AdminProduct> {
    if (!(await this.repo.findProduct(id))) throw new NotFoundException('Product not found');
    await this.repo.update(id, { status: 'ARCHIVED' });
    return this.get(id);
  }

  async updateVariant(id: string, dto: UpdateVariantDto) {
    const v = await this.repo.findVariant(id);
    if (!v) throw new NotFoundException('Variant not found');
    const price = dto.priceKobo ?? v.priceKobo;
    const compareAt = dto.compareAtKobo !== undefined ? dto.compareAtKobo : v.compareAtKobo;
    if (compareAt !== null && compareAt <= price) throw new BadRequestException('compareAtKobo must be greater than the price');
    if (dto.sku && dto.sku !== v.sku && (await this.repo.existingSkus([dto.sku])).size) throw new ConflictException('SKU already in use');
    const updated = await this.repo.updateVariant(id, {
      ...(dto.priceKobo !== undefined ? { priceKobo: dto.priceKobo } : {}),
      ...(dto.compareAtKobo !== undefined ? { compareAtKobo: dto.compareAtKobo } : {}),
      ...(dto.stock !== undefined ? { stock: dto.stock } : {}),
      ...(dto.sku ? { sku: dto.sku.trim() } : {}),
    });
    return updated;
  }

  async exportStockCsv(): Promise<string> {
    const rows = await this.repo.stockRows();
    return toCsv([['sku', 'product', 'colour', 'size', 'stock'], ...rows.map((r) => [r.sku, r.product, r.colour, r.size, r.stock])]);
  }

  /** CSV with at least `sku` and `stock` columns (header row required). Sets absolute stock. */
  async importStockCsv(text: string): Promise<{ updated: number; errors: { line: number; sku: string | null; message: string }[] }> {
    const rows = parseCsv(text);
    if (!rows.length) throw new BadRequestException('The CSV is empty');
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const skuIdx = header.indexOf('sku');
    const stockIdx = header.indexOf('stock');
    if (skuIdx < 0 || stockIdx < 0) throw new BadRequestException('The CSV needs a header row with "sku" and "stock" columns');
    const errors: { line: number; sku: string | null; message: string }[] = [];
    const updates = new Map<string, { sku: string; stock: number; line: number }>();
    rows.slice(1).forEach((r, i) => {
      const line = i + 2;
      const sku = (r[skuIdx] ?? '').trim();
      const raw = (r[stockIdx] ?? '').trim();
      if (!sku) return errors.push({ line, sku: null, message: 'Missing sku' });
      if (!/^\d+$/.test(raw) || Number(raw) > 100000) return errors.push({ line, sku, message: `Invalid stock "${raw}"` });
      updates.set(sku, { sku, stock: Number(raw), line });
    });
    const { updated, missing } = await this.repo.setStock([...updates.values()]);
    for (const sku of missing) errors.push({ line: updates.get(sku)?.line ?? 0, sku, message: 'Unknown SKU' });
    errors.sort((a, b) => a.line - b.line);
    return { updated, errors };
  }

  /* ---------------------------------------------------------- collections */

  async collections(): Promise<(Collection & { exchangeable: boolean; sortOrder: number; productCount: number })[]> {
    const rows = await this.repo.collections();
    return rows.map((c) => ({ ...toCollection(c, c.productCount), exchangeable: c.exchangeable, sortOrder: c.sortOrder, productCount: c.productCount }));
  }

  private parseDate(v: string | null | undefined): Date | null | undefined {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) throw new BadRequestException('goLiveAt must be an ISO 8601 date');
    return d;
  }

  async createCollection(dto: CollectionDto) {
    const slug = slugify(dto.slug || dto.name);
    if (!slug) throw new BadRequestException('Invalid slug');
    if (await this.repo.collectionSlugTaken(slug)) throw new ConflictException('A collection with this slug already exists');
    const c = await this.repo.createCollection({
      slug,
      name: dto.name.trim(),
      description: dto.description ?? null,
      isDrop: dto.isDrop ?? false,
      goLiveAt: this.parseDate(dto.goLiveAt) ?? null,
      heroPattern: dto.heroPattern ?? null,
      exchangeable: dto.exchangeable ?? true,
      sortOrder: dto.sortOrder ?? 0,
      heroImageUrl: cleanText(dto.heroImageUrl),
      homeOrder: dto.homeOrder ?? null,
      tagline: cleanText(dto.tagline),
    });
    this.settings.invalidate();
    return { ...toCollection(c, 0), exchangeable: c.exchangeable, sortOrder: c.sortOrder };
  }

  async updateCollection(id: string, dto: UpdateCollectionDto) {
    const current = await this.repo.findCollection(id);
    if (!current) throw new NotFoundException('Collection not found');
    const patch: Parameters<AdminProductsRepository['updateCollection']>[1] = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.slug !== undefined) {
      const slug = slugify(dto.slug);
      if (slug !== current.slug && (await this.repo.collectionSlugTaken(slug, id))) throw new ConflictException('A collection with this slug already exists');
      patch.slug = slug;
    }
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.isDrop !== undefined) patch.isDrop = dto.isDrop;
    const goLive = this.parseDate(dto.goLiveAt);
    if (goLive !== undefined) patch.goLiveAt = goLive;
    if (dto.heroPattern !== undefined) patch.heroPattern = dto.heroPattern;
    if (dto.exchangeable !== undefined) patch.exchangeable = dto.exchangeable;
    if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder;
    if (dto.heroImageUrl !== undefined) patch.heroImageUrl = cleanText(dto.heroImageUrl);
    if (dto.homeOrder !== undefined) patch.homeOrder = dto.homeOrder;
    if (dto.tagline !== undefined) patch.tagline = cleanText(dto.tagline);
    const c = await this.repo.updateCollection(id, patch);
    if (!c) throw new NotFoundException('Collection not found');
    return { ...toCollection(c, 0), exchangeable: c.exchangeable, sortOrder: c.sortOrder };
  }

  async deleteCollection(id: string) {
    if (!(await this.repo.deleteCollection(id))) throw new NotFoundException('Collection not found');
    return { ok: true };
  }
}

/** Trims optional text; empty → null (design v3 collection hero fields). */
export function cleanText(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t ? t : null;
}
