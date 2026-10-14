import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import { ContentModule } from '../content/content.module';
import { CreditModule } from '../credit/credit.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { MeModule } from '../me/me.module';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';

@Module({
  imports: [CartModule, ContentModule, CreditModule, OrdersModule, PaymentsModule, MeModule],
  controllers: [CheckoutController],
  providers: [CheckoutService],
})
export class CheckoutModule {}
