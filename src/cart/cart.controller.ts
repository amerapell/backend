import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, OptionalJwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/auth-types';
import { CartService, CartIdentity } from './cart.service';
import { CartIdentityParam } from './cart-identity';
import { AddLineDto, CreateCartDto, MergeCartDto, PromoDto, UpdateLineDto } from './cart.dto';

@Controller('cart')
@UseGuards(OptionalJwtAuthGuard)
export class CartController {
  constructor(private readonly carts: CartService) {}

  @Post()
  @HttpCode(201)
  create(@CartIdentityParam() id: CartIdentity, @Body() dto: CreateCartDto) {
    return this.carts.create(id, dto.utm);
  }

  @Get()
  async get(@CartIdentityParam() id: CartIdentity) {
    const cart = await this.carts.resolve(id);
    return this.carts.view(cart.id);
  }

  @Post('lines')
  async addLine(@CartIdentityParam() id: CartIdentity, @Body() dto: AddLineDto) {
    const cart = await this.carts.resolve(id, { create: true });
    return this.carts.addLine(cart, dto.variantId, dto.quantity);
  }

  @Patch('lines/:lineId')
  async updateLine(@CartIdentityParam() id: CartIdentity, @Param('lineId') lineId: string, @Body() dto: UpdateLineDto) {
    const cart = await this.carts.resolve(id);
    return this.carts.updateLine(cart, lineId, dto);
  }

  @Delete('lines/:lineId')
  async removeLine(@CartIdentityParam() id: CartIdentity, @Param('lineId') lineId: string) {
    const cart = await this.carts.resolve(id);
    return this.carts.removeLine(cart, lineId);
  }

  @Post('promo')
  @HttpCode(200)
  async applyPromo(@CartIdentityParam() id: CartIdentity, @Body() dto: PromoDto) {
    const cart = await this.carts.resolve(id);
    return this.carts.applyPromo(cart, dto.code);
  }

  @Delete('promo')
  async removePromo(@CartIdentityParam() id: CartIdentity) {
    const cart = await this.carts.resolve(id);
    return this.carts.removePromo(cart);
  }

  @Post('merge')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  merge(@CurrentUser() user: AuthUser, @Body() dto: MergeCartDto) {
    return this.carts.merge(user.id, dto.guestToken);
  }
}
