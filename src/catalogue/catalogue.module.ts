import { Module } from '@nestjs/common';
import { CatalogueController } from './catalogue.controller';
import { CatalogueService } from './catalogue.service';
import { CATALOGUE_REPOSITORY, DrizzleCatalogueRepository } from './catalogue.repository';
import { DrizzleInventoryRepository, INVENTORY_REPOSITORY } from './inventory.repository';

@Module({
  controllers: [CatalogueController],
  providers: [
    CatalogueService,
    { provide: CATALOGUE_REPOSITORY, useClass: DrizzleCatalogueRepository },
    { provide: INVENTORY_REPOSITORY, useClass: DrizzleInventoryRepository },
  ],
  exports: [CatalogueService, CATALOGUE_REPOSITORY, INVENTORY_REPOSITORY],
})
export class CatalogueModule {}
