import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { CLOCK, Clock } from '../common/clock';
import { DRIZZLE, Database } from '../db/database.module';
import { stockNotifications } from '../db/schema';
import { CATALOGUE_REPOSITORY, CatalogueRepository } from './catalogue.repository';
import { isScheduled } from './product-presenter';

export const STOCK_NOTIFY_REPOSITORY = Symbol('STOCK_NOTIFY_REPOSITORY');

export class StockNotifyDto {
  @IsEmail() @MaxLength(200) email: string;
  @IsString() @IsNotEmpty() @MaxLength(60) variantId: string;
}

export interface StockNotifyRepository {
  /** Idempotent: one sign-up per email + variant. */
  add(entry: { email: string; productId: string; variantId: string }): Promise<void>;
}

@Injectable()
export class DrizzleStockNotifyRepository implements StockNotifyRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async add(entry: { email: string; productId: string; variantId: string }) {
    await this.db.insert(stockNotifications).values(entry).onConflictDoNothing();
  }
}

/** "Notify me" for a sold-out size on the product page. */
@Injectable()
export class StockNotifyService {
  constructor(
    @Inject(CATALOGUE_REPOSITORY) private readonly catalogue: CatalogueRepository,
    @Inject(STOCK_NOTIFY_REPOSITORY) private readonly repo: StockNotifyRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async subscribe(slug: string, email: string, variantId: string) {
    const id = await this.catalogue.findProductIdBySlug(slug);
    const [agg] = id ? await this.catalogue.loadAggregates([id]) : [];
    if (!agg || agg.product.status !== 'LIVE' || isScheduled(agg, this.clock.now())) throw new NotFoundException('Product not found');
    const variant = agg.variants.find((v) => v.id === variantId && !v.archived);
    if (!variant) throw new BadRequestException('Unknown size for this product');
    await this.repo.add({ email: email.trim().toLowerCase(), productId: agg.product.id, variantId: variant.id });
    return { ok: true as const };
  }
}
