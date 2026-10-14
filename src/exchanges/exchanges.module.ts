import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { CreditModule } from '../credit/credit.module';
import { ExchangesController } from './exchanges.controller';
import { ExchangesService } from './exchanges.service';
import { DrizzleExchangesRepository, EXCHANGES_REPOSITORY } from './exchanges.repository';

@Module({
  imports: [OrdersModule, CreditModule],
  controllers: [ExchangesController],
  providers: [ExchangesService, { provide: EXCHANGES_REPOSITORY, useClass: DrizzleExchangesRepository }],
  exports: [ExchangesService, EXCHANGES_REPOSITORY],
})
export class ExchangesModule {}
