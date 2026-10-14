import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { ContentModule } from '../content/content.module';
import { CreditModule } from '../credit/credit.module';
import { ExchangesModule } from '../exchanges/exchanges.module';
import { OrdersModule } from '../orders/orders.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { AddressesService } from './addresses.service';
import { DrizzleMeRepository, ME_REPOSITORY } from './me.repository';

@Module({
  imports: [AuthModule, CatalogueModule, ContentModule, CreditModule, ExchangesModule, OrdersModule],
  controllers: [MeController],
  providers: [MeService, AddressesService, { provide: ME_REPOSITORY, useClass: DrizzleMeRepository }],
  exports: [AddressesService],
})
export class MeModule {}
