import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { HTTP_FETCH, PAYMENT_PROVIDERS, PaymentProvider } from './payment-provider';
import { PaystackProvider } from './paystack/paystack.provider';
import { BachsProvider } from './bachs/bachs.provider';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { PaymentsService } from './payments.service';
import { WebhooksController } from './webhooks.controller';
import { DrizzleWebhookEventsRepository, WEBHOOK_EVENTS_REPOSITORY } from './webhook-events.repository';
import { StockHoldScheduler } from './stock-hold.scheduler';

@Module({
  imports: [OrdersModule],
  controllers: [WebhooksController],
  providers: [
    { provide: HTTP_FETCH, useValue: ((...args: Parameters<typeof fetch>) => fetch(...args)) as typeof fetch },
    PaystackProvider,
    BachsProvider,
    {
      provide: PAYMENT_PROVIDERS,
      inject: [PaystackProvider, BachsProvider],
      useFactory: (...providers: PaymentProvider[]) => providers,
    },
    PaymentProviderRegistry,
    PaymentsService,
    StockHoldScheduler,
    { provide: WEBHOOK_EVENTS_REPOSITORY, useClass: DrizzleWebhookEventsRepository },
  ],
  exports: [PaymentProviderRegistry, PaymentsService],
})
export class PaymentsModule {}
