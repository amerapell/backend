import { Module } from '@nestjs/common';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { CART_REPOSITORY, DrizzleCartRepository } from './cart.repository';

@Module({
  imports: [CatalogueModule],
  controllers: [CartController],
  providers: [CartService, { provide: CART_REPOSITORY, useClass: DrizzleCartRepository }],
  exports: [CartService],
})
export class CartModule {}
