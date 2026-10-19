import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { addMinutes, CLOCK, Clock } from '../common/clock';
import type { AuthUser } from '../common/auth-types';
import type { Order, ProviderCode, Quote, ZoneCode } from '../common/contract';
import { randomToken } from '../common/ids';
import { allocateProportionally } from '../common/money';
import { isInternationalZone } from '../common/countries';
import { normalizeInternationalPhone, normalizeNigerianPhone } from '../common/phone';
import { CartIdentity, CartService, PricedCart } from '../cart/cart.service';
import { CreditService } from '../credit/credit.service';
import { EMAIL_VERIFICATION_LOOKUP, EmailVerificationLookup } from '../credit/email-verification.lookup';
import { DELIVERY_ZONES_REPOSITORY, DeliveryZonesRepository, CONTENT_REPOSITORY, ContentRepository } from '../content/content.repository';
import { ORDERS_REPOSITORY, OrdersRepository, CreditUnavailableError, InsufficientStockError, NewOrderItem } from '../orders/orders.repository';
import { OrdersService } from '../orders/orders.service';
import { OrderLifecycleService } from '../orders/order-lifecycle.service';
import { PaymentProviderRegistry } from '../payments/payment-provider.registry';
import { PaymentProviderError } from '../payments/payment-provider';
import { AddressesService } from '../me/addresses.service';
import { SettingsService } from '../settings/settings.service';
import type { DeliveryZoneRow } from '../db/schema';
import { computeQuote, QuoteTotals } from './pricing';
import { normaliseAddress } from './address-normaliser';
import { CheckoutDto } from './checkout.dto';

export interface CheckoutResult {
  order: Order;
  payment: { provider: ProviderCode | 'CREDIT'; authorizationUrl: string | null; reference: string };
}

/** CHK-1..5, PAY-4, EXC-5. */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger('CheckoutService');

  constructor(
    private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly carts: CartService,
    private readonly credit: CreditService,
    @Inject(DELIVERY_ZONES_REPOSITORY) private readonly zones: DeliveryZonesRepository,
    @Inject(CONTENT_REPOSITORY) private readonly content: ContentRepository,
    @Inject(ORDERS_REPOSITORY) private readonly orders: OrdersRepository,
    private readonly ordersView: OrdersService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly registry: PaymentProviderRegistry,
    private readonly addresses: AddressesService,
    private readonly settings: SettingsService,
    @Inject(EMAIL_VERIFICATION_LOOKUP) private readonly verification: EmailVerificationLookup,
  ) {}

  private async zone(code: ZoneCode): Promise<DeliveryZoneRow> {
    const z = await this.zones.findByCode(code);
    if (!z || !z.active) throw new BadRequestException('This delivery method is not available');
    return z;
  }

  private customer(user?: AuthUser): AuthUser | null {
    return user && user.role === 'CUSTOMER' ? user : null;
  }

  private async totals(priced: PricedCart, zone: DeliveryZoneRow, useCredit: boolean, user: AuthUser | null): Promise<QuoteTotals> {
    const promo = priced.promoResult;
    const { freeDeliveryThresholdKobo } = await this.settings.get();
    return computeQuote({
      subtotalKobo: priced.subtotalKobo,
      discountKobo: promo?.valid ? promo.discountKobo : 0,
      freeDeliveryPromo: promo?.valid ? promo.freeDelivery : false,
      zone: { code: zone.code, feeKobo: zone.feeKobo },
      freeDeliveryThresholdKobo,
      // Credit is tied to the email address: only an account that has verified it may spend it.
      creditAvailableKobo: user && (await this.verification.isVerified(user.id)) ? await this.credit.balance(user.email) : 0,
      useCredit,
    });
  }

  async quote(identity: CartIdentity, zoneCode: ZoneCode, useCredit: boolean, user?: AuthUser): Promise<Quote> {
    const cart = await this.carts.resolve(identity);
    const priced = await this.carts.price(cart.id);
    const totals = await this.totals(priced, await this.zone(zoneCode), useCredit, this.customer(user));
    return { ...totals, problems: priced.lines.filter((l) => l.problem !== null) };
  }

  async checkout(identity: CartIdentity, dto: CheckoutDto, user?: AuthUser): Promise<CheckoutResult> {
    const customer = this.customer(user);
    const cart = await this.carts.resolve(identity);
    const priced = await this.carts.price(cart.id);
    if (!priced.lines.length) throw new BadRequestException('Your bag is empty');
    const problems = priced.lines.filter((l) => l.problem !== null);
    if (problems.length) {
      throw new ConflictException(`Some pieces in your bag are no longer available: ${problems.map((p) => `${p.name}${p.size ? ` (${p.size})` : ''}`).join(', ')}`);
    }
    if (priced.promoResult && !priced.promoResult.valid) throw new BadRequestException(priced.promoResult.reason);

    const zone = await this.zone(dto.zoneCode);
    const abroad = isInternationalZone(zone.code);
    const phone = abroad ? normalizeInternationalPhone(dto.phone) : normalizeNigerianPhone(dto.phone);
    if (!phone) throw new BadRequestException(abroad ? 'Enter a phone number with its country code (e.g. +44 7700 900123)' : 'Enter a valid Nigerian phone number (080… or +234…)');
    const address = zone.code === 'PICKUP' ? null : dto.address ? normaliseAddress(dto.address, zone.code) : null;
    if (zone.code !== 'PICKUP' && !address) throw new BadRequestException('A delivery address is required');

    const totals = await this.totals(priced, zone, dto.useCredit, customer);
    const paidByCreditOnly = totals.amountDueKobo === 0;
    const provider = paidByCreditOnly ? null : await this.registry.getEnabled(dto.provider);

    const now = this.clock.now();
    const lineTotals = priced.lines.map((l) => l.lineKobo);
    const discountShares = allocateProportionally(lineTotals, totals.discountKobo);
    const items: NewOrderItem[] = priced.lines.map((l, idx) => {
      const snap = priced.snapshots.get(l.variantId);
      if (!snap) throw new ConflictException('Your bag changed — please review it');
      return {
        productId: snap.productId,
        variantId: snap.variantId,
        sku: snap.sku,
        name: snap.productName,
        number: snap.number,
        colour: snap.colour,
        size: snap.size,
        material: snap.material,
        imageUrl: snap.imageUrl,
        unitKobo: l.unitKobo,
        paidUnitKobo: Math.floor((l.lineKobo - discountShares[idx]) / l.quantity),
        quantity: l.quantity,
        exchangeable: snap.exchangeable,
      };
    });

    const email = dto.email.trim().toLowerCase();
    let created;
    try {
      created = await this.orders.createWithHolds({
        userId: customer?.id ?? null,
        cartId: cart.id,
        email,
        creditEmail: customer?.email ?? email,
        phone,
        zoneCode: zone.code,
        zoneName: zone.name,
        address,
        subtotalKobo: totals.subtotalKobo,
        discountKobo: totals.discountKobo,
        discountCode: priced.promoResult?.valid ? priced.cart.promoCode : null,
        deliveryKobo: totals.deliveryKobo,
        creditAppliedKobo: totals.creditAppliedKobo,
        totalKobo: totals.totalKobo,
        amountDueKobo: totals.amountDueKobo,
        paymentProvider: provider ? provider.code : 'CREDIT',
        utm: { source: cart.utmSource, medium: cart.utmMedium, campaign: cart.utmCampaign },
        marketingConsent: dto.marketingConsent === true,
        holdExpiresAt: addMinutes(now, this.config.values.stockHoldMinutes),
        now,
        items,
      });
    } catch (err) {
      if (err instanceof InsufficientStockError || err instanceof CreditUnavailableError) throw new ConflictException(err.message);
      throw err;
    }
    const { order } = created;

    await this.sideEffects(dto, customer, email, address);

    if (!provider) {
      const reference = `${order.number}-CREDIT`;
      await this.orders.setPayment(order.id, { paymentReference: reference });
      await this.lifecycle.markPaid({ ...order, paymentReference: reference });
      return { order: await this.ordersView.byId(order.id), payment: { provider: 'CREDIT', authorizationUrl: null, reference } };
    }

    const reference = `${order.number}-${randomToken(6).replace(/[^A-Za-z0-9]/g, 'x')}`;
    await this.orders.setPayment(order.id, { paymentReference: reference });
    const front = this.config.values.frontendUrl;
    try {
      const init = await provider.initialize({
        orderId: order.id,
        orderNumber: order.number,
        email,
        amountKobo: totals.amountDueKobo,
        reference,
        callbackUrl: `${front}/checkout/complete?reference=${encodeURIComponent(reference)}`,
        cancelUrl: `${front}/checkout?cancelled=1&reference=${encodeURIComponent(reference)}`,
      });
      if (init.providerSessionId) await this.orders.setPayment(order.id, { providerSessionId: init.providerSessionId });
      return {
        order: await this.ordersView.byId(order.id),
        payment: { provider: provider.code, authorizationUrl: init.authorizationUrl, reference },
      };
    } catch (err) {
      this.logger.error(`Payment init failed for ${order.number}: ${(err as Error).message}`);
      await this.lifecycle.cancelUnpaid({ ...order, paymentReference: reference }, 'FAILED');
      // Provider rejected the request, timed out or was unreachable: the order is already cancelled and stock released.
      throw new BadGatewayException(`${provider.displayName} could not start the payment. Please try again or choose another method.`);
    }
  }

  private async sideEffects(dto: CheckoutDto, customer: AuthUser | null, email: string, address: ReturnType<typeof normaliseAddress> | null) {
    try {
      if (dto.marketingConsent === true) await this.content.subscribe(email, true, 'checkout');
      if (customer && dto.saveAddress && address) await this.addresses.saveIfNew(customer.id, address);
    } catch (err) {
      this.logger.warn(`Checkout side effect failed: ${(err as Error).message}`);
    }
  }
}
