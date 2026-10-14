import { Module } from '@nestjs/common';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';
import { CONTENT_REPOSITORY, DELIVERY_ZONES_REPOSITORY, DrizzleContentRepository, DrizzleDeliveryZonesRepository } from './content.repository';

@Module({
  controllers: [ContentController],
  providers: [
    ContentService,
    { provide: CONTENT_REPOSITORY, useClass: DrizzleContentRepository },
    { provide: DELIVERY_ZONES_REPOSITORY, useClass: DrizzleDeliveryZonesRepository },
  ],
  exports: [ContentService, CONTENT_REPOSITORY, DELIVERY_ZONES_REPOSITORY],
})
export class ContentModule {}
