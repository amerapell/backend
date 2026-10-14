import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/auth-types';
import { AddressDto } from '../checkout/checkout.dto';
import { OrdersService } from '../orders/orders.service';
import { CreditService } from '../credit/credit.service';
import { MeService } from './me.service';
import { AddressesService } from './addresses.service';
import { UpdateMeDto } from './me.dto';

@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(
    private readonly me: MeService,
    private readonly addresses: AddressesService,
    private readonly orders: OrdersService,
    private readonly credit: CreditService,
  ) {}

  @Get()
  profile(@CurrentUser() user: AuthUser) {
    return this.me.profile(user.id);
  }

  /** Addition: update name / phone / marketing consent. */
  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return this.me.updateProfile(user.id, dto);
  }

  @Delete()
  @HttpCode(200)
  remove(@CurrentUser() user: AuthUser) {
    return this.me.deleteAccount(user.id);
  }

  @Get('orders')
  myOrders(@CurrentUser() user: AuthUser) {
    return this.orders.forUser(user.id);
  }

  @Get('orders/:number')
  myOrder(@CurrentUser() user: AuthUser, @Param('number') number: string) {
    return this.orders.forUserByNumber(user.id, number);
  }

  @Get('addresses')
  listAddresses(@CurrentUser() user: AuthUser) {
    return this.addresses.list(user.id);
  }

  @Post('addresses')
  @HttpCode(201)
  createAddress(@CurrentUser() user: AuthUser, @Body() dto: AddressDto) {
    return this.addresses.create(user.id, dto);
  }

  @Patch('addresses/:id')
  updateAddress(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AddressDto) {
    return this.addresses.update(user.id, id, dto);
  }

  @Delete('addresses/:id')
  deleteAddress(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.addresses.remove(user.id, id);
  }

  @Get('wishlist')
  wishlist(@CurrentUser() user: AuthUser) {
    return this.me.wishlist(user.id);
  }

  @Post('wishlist/:productId')
  @HttpCode(200)
  addWishlist(@CurrentUser() user: AuthUser, @Param('productId') productId: string) {
    return this.me.addToWishlist(user.id, productId);
  }

  @Delete('wishlist/:productId')
  removeWishlist(@CurrentUser() user: AuthUser, @Param('productId') productId: string) {
    return this.me.removeFromWishlist(user.id, productId);
  }

  @Get('credit')
  myCredit(@CurrentUser() user: AuthUser) {
    return this.credit.statement(user.email);
  }

  @Get('data-export')
  exportData(@CurrentUser() user: AuthUser) {
    return this.me.exportData(user);
  }
}
