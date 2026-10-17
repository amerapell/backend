import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CatalogueService } from './catalogue.service';
import { parseListQuery } from './catalogue.query';
import { StockNotifyDto, StockNotifyService } from './stock-notify';

@Controller()
export class CatalogueController {
  constructor(
    private readonly catalogue: CatalogueService,
    private readonly stockNotify: StockNotifyService,
  ) {}

  @Get('collections')
  collections() {
    return this.catalogue.listCollections();
  }

  @Get('collections/:slug')
  collection(@Param('slug') slug: string, @Query() query: Record<string, unknown>) {
    const { collectionSlug: _ignored, ...rest } = parseListQuery(query);
    return this.catalogue.getCollection(slug, rest);
  }

  @Get('products')
  products(@Query() query: Record<string, unknown>) {
    return this.catalogue.listProducts(parseListQuery(query));
  }

  @Get('products/:slug')
  product(@Param('slug') slug: string) {
    return this.catalogue.getProduct(slug);
  }

  /** "Notify me" when a sold-out size comes back. */
  @Post('products/:slug/notify')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  notify(@Param('slug') slug: string, @Body() dto: StockNotifyDto) {
    return this.stockNotify.subscribe(slug, dto.email, dto.variantId);
  }

  @Get('search/suggest')
  suggest(@Query('q') q = '') {
    return this.catalogue.suggest(String(q));
  }
}
