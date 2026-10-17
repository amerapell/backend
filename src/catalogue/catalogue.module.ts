import { Module } from '@nestjs/common';
import { CatalogueController } from './catalogue.controller';
import { CatalogueService } from './catalogue.service';
import { CATALOGUE_REPOSITORY, DrizzleCatalogueRepository } from './catalogue.repository';
import { DrizzleInventoryRepository, INVENTORY_REPOSITORY } from './inventory.repository';
import { DrizzleStockNotifyRepository, STOCK_NOTIFY_REPOSITORY, StockNotifyService } from './stock-notify';

@Module({
  controllers: [CatalogueController],
  providers: [
    CatalogueService,
    StockNotifyService,
    { provide: STOCK_NOTIFY_REPOSITORY, useClass: DrizzleStockNotifyRepository },
    { provide: CATALOGUE_REPOSITORY, useClass: DrizzleCatalogueRepository },
    { provide: INVENTORY_REPOSITORY, useClass: DrizzleInventoryRepository },
  ],
  exports: [CatalogueService, CATALOGUE_REPOSITORY, INVENTORY_REPOSITORY],
})
export class CatalogueModule {}
