import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import { CreditModule } from '../credit/credit.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { DrizzleOrdersRepository, ORDERS_REPOSITORY } from './orders.repository';

@Module({
  imports: [CartModule, CreditModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderLifecycleService, { provide: ORDERS_REPOSITORY, useClass: DrizzleOrdersRepository }],
  exports: [OrdersService, OrderLifecycleService, ORDERS_REPOSITORY],
})
export class OrdersModule {}
