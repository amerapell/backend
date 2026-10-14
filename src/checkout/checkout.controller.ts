import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { OptionalJwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/auth-types';
import { CartIdentityParam } from '../cart/cart-identity';
import type { CartIdentity } from '../cart/cart.service';
import { PaymentsService } from '../payments/payments.service';
import { CheckoutService } from './checkout.service';
import { CheckoutDto, QuoteDto } from './checkout.dto';

@Controller('checkout')
@UseGuards(OptionalJwtAuthGuard)
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly payments: PaymentsService,
  ) {}

  @Post('quote')
  @HttpCode(200)
  quote(@CartIdentityParam() id: CartIdentity, @Body() dto: QuoteDto, @CurrentUser() user?: AuthUser) {
    return this.checkout.quote(id, dto.zoneCode, dto.useCredit, user);
  }

  @Post()
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(@CartIdentityParam() id: CartIdentity, @Body() dto: CheckoutDto, @CurrentUser() user?: AuthUser) {
    return this.checkout.checkout(id, dto, user);
  }

  /** Return-URL page calls this; the server re-verifies with the provider. Webhook remains the source of truth. */
  @Get('verify')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  verify(@Query('reference') reference?: string) {
    if (!reference) throw new BadRequestException('reference is required');
    return this.payments.verifyByReference(reference);
  }
}
