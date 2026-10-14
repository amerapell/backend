import { Controller, Get, Param, Query } from '@nestjs/common';
import { CatalogueService } from './catalogue.service';
import { parseListQuery } from './catalogue.query';

@Controller()
export class CatalogueController {
  constructor(private readonly catalogue: CatalogueService) {}

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

  @Get('search/suggest')
  suggest(@Query('q') q = '') {
    return this.catalogue.suggest(String(q));
  }
}
