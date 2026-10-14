import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './db/database.module';
import { GuardsModule } from './common/guards/guards.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { SettingsModule } from './settings/settings.module';
import { EmailModule } from './email/email.module';
import { StorageModule } from './storage/storage.module';
import { HealthModule } from './health/health.module';
import { CatalogueModule } from './catalogue/catalogue.module';
import { CartModule } from './cart/cart.module';
import { CreditModule } from './credit/credit.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { CheckoutModule } from './checkout/checkout.module';
import { ExchangesModule } from './exchanges/exchanges.module';
import { AuthModule } from './auth/auth.module';
import { MeModule } from './me/me.module';
import { ContentModule } from './content/content.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    // infrastructure
    ConfigModule,
    DatabaseModule,
    GuardsModule,
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    SettingsModule,
    EmailModule,
    StorageModule,
    HealthModule,
    // domains
    CatalogueModule,
    CartModule,
    CreditModule,
    OrdersModule,
    PaymentsModule,
    CheckoutModule,
    ExchangesModule,
    AuthModule,
    MeModule,
    ContentModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
