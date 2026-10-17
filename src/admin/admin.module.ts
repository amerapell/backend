import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { ContentModule } from '../content/content.module';
import { ExchangesModule } from '../exchanges/exchanges.module';
import { OrdersModule } from '../orders/orders.module';
import { AdminAuthController } from './auth/admin-auth.controller';
import { AdminAuthService } from './auth/admin-auth.service';
import { OtplibTotpService, TOTP } from './auth/totp';
import { AdminDashboardController } from './dashboard/dashboard.controller';
import { DASHBOARD_REPOSITORY, DrizzleDashboardRepository } from './dashboard/dashboard.repository';
import { DashboardService } from './dashboard/dashboard.service';
import { AdminCustomersController } from './customers/customers.controller';
import { AdminCustomersService } from './customers/customers.service';
import { CUSTOMERS_REPOSITORY, DrizzleCustomersRepository } from './customers/customers.repository';
import {
  AdminCollectionsController,
  AdminProductsController,
  AdminStockController,
  AdminUploadsController,
  AdminVariantsController,
} from './products/admin-products.controller';
import { AdminProductsService } from './products/admin-products.service';
import { ADMIN_PRODUCTS_REPOSITORY, DrizzleAdminProductsRepository } from './products/admin-products.repository';
import { AdminExchangesController, AdminOrdersController } from './orders/admin-orders.controller';
import {
  AdminDeliveryZonesController,
  AdminDiscountsController,
  AdminFaqController,
  AdminPagesController,
  AdminSettingsController,
} from './content/admin-content.controller';
import { DISCOUNTS_REPOSITORY, DrizzleDiscountsRepository } from './content/discounts.repository';

@Module({
  imports: [AuthModule, CatalogueModule, ContentModule, ExchangesModule, OrdersModule],
  controllers: [
    AdminAuthController,
    AdminDashboardController,
    AdminProductsController,
    AdminVariantsController,
    AdminStockController,
    AdminUploadsController,
    AdminCollectionsController,
    AdminOrdersController,
    AdminCustomersController,
    AdminExchangesController,
    AdminDiscountsController,
    AdminDeliveryZonesController,
    AdminSettingsController,
    AdminFaqController,
    AdminPagesController,
  ],
  providers: [
    AdminAuthService,
    AdminProductsService,
    { provide: TOTP, useClass: OtplibTotpService },
    { provide: DASHBOARD_REPOSITORY, useClass: DrizzleDashboardRepository },
    DashboardService,
    AdminCustomersService,
    { provide: CUSTOMERS_REPOSITORY, useClass: DrizzleCustomersRepository },
    { provide: ADMIN_PRODUCTS_REPOSITORY, useClass: DrizzleAdminProductsRepository },
    { provide: DISCOUNTS_REPOSITORY, useClass: DrizzleDiscountsRepository },
  ],
})
export class AdminModule {}
