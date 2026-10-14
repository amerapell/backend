import { createHmac } from 'crypto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CartService } from '../src/cart/cart.service';
import { CheckoutService } from '../src/checkout/checkout.service';
import { CreditService } from '../src/credit/credit.service';
import { NotificationsService } from '../src/email/notifications.service';
import { ExchangesService } from '../src/exchanges/exchanges.service';
import { OrderLifecycleService } from '../src/orders/order-lifecycle.service';
import { OrdersService } from '../src/orders/orders.service';
import { PaymentProviderRegistry } from '../src/payments/payment-provider.registry';
import { PaymentsService } from '../src/payments/payments.service';
import type { PaymentProvider, VerifyPaymentResult } from '../src/payments/payment-provider';
import { PaystackProvider } from '../src/payments/paystack/paystack.provider';
import type { ContentRepository, DeliveryZonesRepository } from '../src/content/content.repository';
import type { AddressesService } from '../src/me/addresses.service';
import type { AuthUser } from '../src/common/auth-types';
import type { CheckoutDto } from '../src/checkout/checkout.dto';
import type { StoredSettings } from '../src/settings/settings.types';
import { FakeClock, fakeFetch, RecordingEmailSender, settingsService, testConfig } from './fakes';
import {
  InMemoryCartRepository,
  InMemoryCreditRepository,
  InMemoryExchangesRepository,
  InMemoryInventory,
  InMemoryOrdersRepository,
  InMemoryWebhookEvents,
  Warehouse,
  zone,
} from './fakes/repositories';

const SECRET = 'sk_test_flow';

function harness(settingsOver: Partial<StoredSettings> = {}) {
  const clock = new FakeClock();
  const config = testConfig({ PAYSTACK_SECRET_KEY: SECRET });
  const settings = settingsService({ freeDeliveryThresholdKobo: null, ...settingsOver });
  const w = new Warehouse(clock);
  const snap = (variantId: string, name: string, priceKobo: number, extra: Partial<{ exchangeable: boolean; size: string }> = {}) => ({
    variantId,
    productId: `p-${name}`,
    productSlug: name.toLowerCase().replace(/\s+/g, '-'),
    productName: name,
    number: 'No. 014',
    material: 'Lamb leather',
    sku: variantId,
    colour: 'Black',
    colourHex: '#16161a',
    size: extra.size ?? 'M',
    priceKobo,
    compareAtKobo: null,
    archived: false,
    productStatus: 'LIVE' as const,
    imageUrl: null,
    scheduled: false,
    exchangeable: extra.exchangeable ?? true,
  });
  w.addVariant(snap('jacket-m', 'Cropped leather jacket', 18_500_000), 2);
  w.addVariant(snap('shirt-l', 'Silk camp-collar shirt', 6_250_000, { size: 'L' }), 5);
  w.addVariant(snap('hoops', 'Gold-tone hoop set', 3_500_000, { exchangeable: false }), 5);

  const creditRepo = new InMemoryCreditRepository(clock);
  const ordersRepo = new InMemoryOrdersRepository(w, creditRepo, clock);
  const cartRepo = new InMemoryCartRepository();
  const exchangesRepo = new InMemoryExchangesRepository(ordersRepo, w, clock);
  const events = new InMemoryWebhookEvents();
  const email = new RecordingEmailSender();
  const notifications = new NotificationsService(email, config, settings);
  const credit = new CreditService(creditRepo, clock, settings);
  const carts = new CartService(cartRepo, new InMemoryInventory(w), clock, settings);
  const ordersView = new OrdersService(ordersRepo, settings);
  const lifecycle = new OrderLifecycleService(ordersRepo, clock, ordersView, credit, carts, notifications);

  // Paystack provider over a fake API whose verify result the test controls.
  let verifyResult: { status: string; amount: number } = { status: 'success', amount: 0 };
  const api = fakeFetch({
    'POST /transaction/initialize': (init) => ({
      body: { status: true, message: 'ok', data: { authorization_url: 'https://checkout.paystack.com/x', reference: JSON.parse(String(init?.body)).reference } },
    }),
  });
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).includes('/transaction/verify/')) {
      return new Response(JSON.stringify({ status: true, message: 'ok', data: { status: verifyResult.status, amount: verifyResult.amount, currency: 'NGN' } }), { status: 200 });
    }
    return api.fn(input, init);
  }) as typeof fetch;
  const paystack = new PaystackProvider(config, fetchFn);
  const registry = new PaymentProviderRegistry([paystack as PaymentProvider], settings);
  const payments = new PaymentsService(registry, ordersRepo, events, clock, lifecycle, ordersView);

  const zones: DeliveryZonesRepository = {
    list: async () => [zone('LEKKI_AJAH', 450_000), zone('PICKUP', 0)],
    findByCode: async (c) => (c === 'LEKKI_AJAH' ? zone('LEKKI_AJAH', 450_000) : c === 'PICKUP' ? zone('PICKUP', 0) : null),
    findById: async () => null,
    update: async () => null,
  };
  const subscribed: string[] = [];
  const content = { subscribe: async (e: string) => void subscribed.push(e) } as unknown as ContentRepository;
  const saved: unknown[] = [];
  const addresses = { saveIfNew: async (_u: string, a: unknown) => void saved.push(a) } as unknown as AddressesService;
  const checkout = new CheckoutService(config, clock, carts, credit, zones, content, ordersRepo, ordersView, lifecycle, registry, addresses, settings);
  const exchanges = new ExchangesService(exchangesRepo, ordersRepo, clock, settings, credit, notifications);

  const signed = (payload: unknown) => {
    const raw = Buffer.from(JSON.stringify(payload));
    return { raw, headers: { 'x-paystack-signature': createHmac('sha512', SECRET).update(raw).digest('hex') } };
  };
  return {
    clock, w, carts, cartRepo, checkout, payments, ordersRepo, creditRepo, credit, exchanges, exchangesRepo, events, email, lifecycle, subscribed, saved, signed,
    setVerify: (status: string, amount: number) => (verifyResult = { status, amount }),
  };
}

const address = { fullName: 'Ada Obi', phone: '0803 123 4567', state: 'lagos', lga: 'eti-osa', area: 'Lekki Phase 1', street: '12 Admiralty Way', landmark: 'Opposite the mall' };
const dto = (over: Partial<CheckoutDto> = {}): CheckoutDto =>
  ({ email: 'Ada@Example.com', phone: '+2348031234567', zoneCode: 'LEKKI_AJAH', address, provider: 'PAYSTACK', useCredit: false, marketingConsent: false, ...over }) as CheckoutDto;
const customer: AuthUser = { id: 'u1', email: 'ada@example.com', role: 'CUSTOMER' };

describe('cart (CRT-2..5)', () => {
  it('caps quantity at available stock and rejects sold-out', async () => {
    const h = harness();
    const cart = await h.carts.resolve({}, { create: true });
    const view = await h.carts.addLine(cart, 'jacket-m', 5);
    expect(view.lines[0]).toMatchObject({ quantity: 2, unitKobo: 18_500_000, lineKobo: 37_000_000, available: 2, problem: null });
    h.w.stock.set('jacket-m', 0);
    await expect(h.carts.addLine(cart, 'jacket-m', 1)).rejects.toBeInstanceOf(ConflictException);
    expect((await h.carts.view(cart.id)).lines[0].problem).toBe('SOLD_OUT');
  });

  it('applies valid promos and rejects invalid ones with a reason', async () => {
    const h = harness();
    h.cartRepo.promos.set('WELCOME10', { code: 'WELCOME10', type: 'PERCENT', value: 10, startsAt: null, endsAt: null, maxUses: null, usedCount: 0, minSubtotalKobo: 10_000_000, active: true });
    const cart = await h.carts.resolve({}, { create: true });
    await h.carts.addLine(cart, 'shirt-l', 1);
    await expect(h.carts.applyPromo(cart, 'welcome10')).rejects.toThrow('minimum spend');
    await h.carts.addLine(cart, 'jacket-m', 1);
    const v = await h.carts.applyPromo(cart, 'welcome10');
    expect(v).toMatchObject({ promoCode: 'WELCOME10', subtotalKobo: 24_750_000, discountKobo: 2_475_000 });
    await expect(h.carts.applyPromo(cart, 'NOPE')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('merges a guest cart into the user cart on login (CRT-3)', async () => {
    const h = harness();
    const guest = await h.carts.resolve({}, { create: true });
    await h.carts.addLine(guest, 'shirt-l', 2);
    const mine = await h.carts.resolve({ userId: 'u1' }, { create: true });
    await h.carts.addLine(mine, 'shirt-l', 1);
    await h.carts.addLine(mine, 'jacket-m', 1);
    const merged = await h.carts.merge('u1', guest.token);
    expect(merged.id).toBe(mine.id);
    expect(merged.lines.find((l) => l.variantId === 'shirt-l')?.quantity).toBe(3);
    expect(merged.itemCount).toBe(4);
    await expect(h.carts.resolve({ token: guest.token })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('checkout → payment (CHK, PAY)', () => {
  async function filledCart(h: ReturnType<typeof harness>, userId?: string) {
    const cart = await h.carts.resolve({ userId }, { create: true });
    await h.carts.addLine(cart, 'jacket-m', 1);
    await h.carts.addLine(cart, 'shirt-l', 1);
    return { token: cart.token, userId };
  }

  it('creates a PENDING_PAYMENT order, holds stock for 15 min and returns the Paystack URL', async () => {
    const h = harness();
    const id = await filledCart(h);
    const res = await h.checkout.checkout(id, dto({ marketingConsent: true }));
    expect(res.payment.provider).toBe('PAYSTACK');
    expect(res.payment.authorizationUrl).toBe('https://checkout.paystack.com/x');
    expect(res.payment.reference).toMatch(/^AP-10501-/);
    expect(res.order).toMatchObject({
      number: 'AP-10501',
      status: 'PENDING_PAYMENT',
      email: 'ada@example.com',
      phone: '+2348031234567',
      subtotalKobo: 24_750_000,
      deliveryKobo: 450_000,
      totalKobo: 25_200_000,
      amountDueKobo: 25_200_000,
      payment: { provider: 'PAYSTACK', status: 'PENDING' },
    });
    expect(res.order.delivery.address).toMatchObject({ phone: '+2348031234567', state: 'Lagos', lga: 'Eti-Osa' });
    expect(h.w.available('jacket-m')).toBe(1);
    expect(h.subscribed).toEqual(['ada@example.com']);
  });

  it('marks PAID only after a signed webhook AND server-side verification; duplicates are no-ops (PAY-3, PAY-5)', async () => {
    const h = harness();
    const { order, payment } = await h.checkout.checkout(await filledCart(h), dto());
    h.setVerify('success', order.amountDueKobo);
    const evt = h.signed({ event: 'charge.success', data: { id: 777, reference: payment.reference, amount: order.amountDueKobo } });

    expect(await h.payments.handleWebhook('PAYSTACK', evt.raw, evt.headers)).toEqual({ ok: true });
    const paid = await h.ordersRepo.findById(order.id);
    expect(paid?.status).toBe('PAID');
    expect(h.w.stock.get('jacket-m')).toBe(1);
    expect(h.w.available('jacket-m')).toBe(1);
    const emailsAfterFirst = h.email.sent.length;
    expect(h.email.sent.map((m) => m.subject)).toEqual(expect.arrayContaining([expect.stringContaining('Order AP-10501 confirmed'), expect.stringContaining('New order AP-10501')]));

    expect(await h.payments.handleWebhook('PAYSTACK', evt.raw, evt.headers)).toEqual({ ok: true, duplicate: true });
    expect(h.w.stock.get('jacket-m')).toBe(1);
    expect(h.email.sent.length).toBe(emailsAfterFirst);
    // The browser return URL also cannot double-pay.
    expect((await h.payments.verifyByReference(payment.reference)).order.status).toBe('PAID');
    expect(h.w.stock.get('jacket-m')).toBe(1);
  });

  it('rejects bad signatures with 400 and never trusts the webhook amount alone', async () => {
    const h = harness();
    const { order, payment } = await h.checkout.checkout(await filledCart(h), dto());
    const evt = h.signed({ event: 'charge.success', data: { id: 1, reference: payment.reference } });
    await expect(h.payments.handleWebhook('PAYSTACK', evt.raw, { 'x-paystack-signature': 'f00d' })).rejects.toBeInstanceOf(BadRequestException);
    h.setVerify('success', order.amountDueKobo - 100); // provider says less was paid
    await h.payments.handleWebhook('PAYSTACK', evt.raw, evt.headers);
    expect((await h.ordersRepo.findById(order.id))?.status).toBe('PENDING_PAYMENT');
    expect(h.ordersRepo.notesList[0].body).toContain('amount mismatch');
  });

  it('a redirect alone does not mark paid while the provider says pending', async () => {
    const h = harness();
    const { payment } = await h.checkout.checkout(await filledCart(h), dto());
    h.setVerify('ongoing', 0);
    expect((await h.payments.verifyByReference(payment.reference)).order.status).toBe('PENDING_PAYMENT');
  });

  it('releases holds after 15 minutes and gives credit back (PAY-4)', async () => {
    const h = harness();
    const { order } = await h.checkout.checkout(await filledCart(h), dto());
    h.setVerify('abandoned', 0);
    h.clock.advance(14 * 60_000);
    expect(await h.payments.expireStaleOrders()).toBe(0);
    h.clock.advance(2 * 60_000);
    expect(await h.payments.expireStaleOrders()).toBe(1);
    expect(await h.ordersRepo.findById(order.id)).toMatchObject({ status: 'CANCELLED', paymentStatus: 'EXPIRED' });
    expect(h.w.available('jacket-m')).toBe(2);
  });

  it('a late verified payment revives an expired order', async () => {
    const h = harness();
    const { order, payment } = await h.checkout.checkout(await filledCart(h), dto());
    h.setVerify('abandoned', 0);
    h.clock.advance(16 * 60_000);
    await h.payments.expireStaleOrders();
    h.setVerify('success', order.amountDueKobo);
    const evt = h.signed({ event: 'charge.success', data: { id: 9, reference: payment.reference } });
    await h.payments.handleWebhook('PAYSTACK', evt.raw, evt.headers);
    expect((await h.ordersRepo.findById(order.id))?.status).toBe('PAID');
  });

  it('flags sold-out lines before payment (CRT-4) and rejects a disabled provider', async () => {
    const h = harness({ paystackEnabled: false });
    const id = await filledCart(h);
    await expect(h.checkout.checkout(id, dto())).rejects.toThrow('currently unavailable');
    h.w.stock.set('jacket-m', 0);
    const quote = await h.checkout.quote(id, 'LEKKI_AJAH', false);
    expect(quote.problems.map((p) => p.problem)).toEqual(['SOLD_OUT']);
    await expect(h.checkout.checkout(id, dto())).rejects.toBeInstanceOf(ConflictException);
  });

  it('validates phone and requires an address unless pickup', async () => {
    const h = harness();
    const id = await filledCart(h);
    await expect(h.checkout.checkout(id, dto({ phone: '12345' }))).rejects.toThrow('valid Nigerian phone');
    await expect(h.checkout.checkout(id, dto({ address: null }))).rejects.toThrow('delivery address is required');
    const pickup = await h.checkout.checkout(id, dto({ zoneCode: 'PICKUP', address: null }));
    expect(pickup.order).toMatchObject({ deliveryKobo: 0, delivery: { zone: 'PICKUP', address: null } });
  });

  it('credit covering everything → PAID without a provider; the remainder stays as credit (EXC-5)', async () => {
    const h = harness();
    await h.creditRepo.add({ email: customer.email, amountKobo: 30_000_000, reason: 'EXCHANGE_CREDIT' });
    const id = await filledCart(h, customer.id);
    const quote = await h.checkout.quote(id, 'LEKKI_AJAH', true, customer);
    expect(quote).toMatchObject({ creditAvailableKobo: 30_000_000, creditAppliedKobo: 25_200_000, amountDueKobo: 0 });
    const res = await h.checkout.checkout(id, dto({ useCredit: true, saveAddress: true }), customer);
    expect(res.payment).toEqual({ provider: 'CREDIT', authorizationUrl: null, reference: `${res.order.number}-CREDIT` });
    expect(res.order).toMatchObject({ status: 'PAID', creditAppliedKobo: 25_200_000, amountDueKobo: 0, payment: { provider: 'CREDIT', status: 'SUCCEEDED' } });
    expect(await h.credit.balance(customer.email)).toBe(4_800_000);
    expect(h.saved).toHaveLength(1);
    // The purchased lines leave the cart.
    expect((await h.carts.view((await h.carts.resolve({ userId: customer.id })).id)).lines).toHaveLength(0);
  });

  it('partial credit: pay the difference; guests can never spend credit', async () => {
    const h = harness();
    await h.creditRepo.add({ email: customer.email, amountKobo: 6_250_000, reason: 'EXCHANGE_CREDIT' });
    const res = await h.checkout.checkout(await filledCart(h, customer.id), dto({ useCredit: true }), customer);
    expect(res.order).toMatchObject({ creditAppliedKobo: 6_250_000, amountDueKobo: 18_950_000 });
    expect(await h.credit.balance(customer.email)).toBe(0);
    const guest = await h.checkout.quote(await filledCart(h), 'LEKKI_AJAH', true);
    expect(guest.creditAppliedKobo).toBe(0);
  });
});

describe('exchanges (EXC-1..8)', () => {
  async function deliveredOrder(h: ReturnType<typeof harness>) {
    const cart = await h.carts.resolve({ userId: customer.id }, { create: true });
    await h.carts.addLine(cart, 'jacket-m', 1);
    await h.carts.addLine(cart, 'shirt-l', 2);
    await h.carts.addLine(cart, 'hoops', 1);
    const { order } = await h.checkout.checkout({ userId: customer.id }, dto(), customer);
    h.setVerify('success', order.amountDueKobo);
    await h.payments.confirm((await h.ordersRepo.findById(order.id))!);
    await h.ordersRepo.updateStatus(order.id, 'DELIVERED', { deliveredAt: h.clock.now() });
    const items = await h.ordersRepo.items(order.id);
    return { order, item: (name: string) => items.find((i) => i.name === name)! };
  }

  it('full lifecycle: request → approve → receive (credit + restock) → complete', async () => {
    const h = harness();
    const { order, item } = await deliveredOrder(h);
    const shirt = item('Silk camp-collar shirt');
    const ex = await h.exchanges.request({ orderNumber: order.number, items: [{ orderItemId: shirt.id, quantity: 1 }], reason: 'Wrong size' }, customer);
    expect(ex).toMatchObject({ number: 'EX-2031', status: 'REQUESTED', items: [{ name: 'Silk camp-collar shirt', quantity: 1, valueKobo: 6_250_000 }] });
    expect((await h.ordersRepo.findById(order.id))?.status).toBe('EXCHANGE_REQUESTED');

    const approved = await h.exchanges.approve(ex.id, 'Bring it by Friday');
    expect(approved.status).toBe('APPROVED');
    expect(h.email.sent.at(-1)?.html).toContain('[Store address]');

    const stockBefore = h.w.stock.get('shirt-l')!;
    const received = await h.exchanges.receive(ex.id);
    expect(received).toMatchObject({ status: 'CREDIT_ISSUED', creditKobo: 6_250_000 });
    expect(received.history.map((s) => s.status)).toEqual(['REQUESTED', 'APPROVED', 'ITEM_RECEIVED', 'CREDIT_ISSUED']);
    expect(h.w.stock.get('shirt-l')).toBe(stockBefore + 1);
    expect(await h.credit.balance(customer.email)).toBe(6_250_000);
    expect(h.email.sent.at(-1)?.subject).toBe('₦62,500 exchange credit added');

    await expect(h.exchanges.receive(ex.id)).rejects.toBeInstanceOf(BadRequestException); // no double credit
    expect((await h.exchanges.complete(ex.id)).status).toBe('COMPLETED');
    expect((await h.ordersRepo.findById(order.id))?.status).toBe('EXCHANGED');
  });

  it('credit equals what was actually paid after a promo', async () => {
    const h = harness();
    h.cartRepo.promos.set('TEN', { code: 'TEN', type: 'PERCENT', value: 10, startsAt: null, endsAt: null, maxUses: null, usedCount: 0, minSubtotalKobo: null, active: true });
    const cart = await h.carts.resolve({ userId: customer.id }, { create: true });
    await h.carts.addLine(cart, 'shirt-l', 1);
    await h.carts.applyPromo(cart, 'TEN');
    const { order } = await h.checkout.checkout({ userId: customer.id }, dto(), customer);
    h.setVerify('success', order.amountDueKobo);
    await h.payments.confirm((await h.ordersRepo.findById(order.id))!);
    await h.ordersRepo.updateStatus(order.id, 'DELIVERED', { deliveredAt: h.clock.now() });
    const [line] = await h.ordersRepo.items(order.id);
    const ex = await h.exchanges.request({ orderNumber: order.number, items: [{ orderItemId: line.id, quantity: 1 }], reason: 'Changed my mind' }, customer);
    expect(ex.items[0].valueKobo).toBe(5_625_000);
  });

  it('enforces window, exchangeability, quantity and ownership', async () => {
    const h = harness();
    const { order, item } = await deliveredOrder(h);
    const hoops = item('Gold-tone hoop set');
    const shirt = item('Silk camp-collar shirt');
    await expect(h.exchanges.request({ orderNumber: order.number, items: [{ orderItemId: hoops.id, quantity: 1 }], reason: 'x' }, customer)).rejects.toThrow('not exchangeable');
    await expect(h.exchanges.request({ orderNumber: order.number, items: [{ orderItemId: shirt.id, quantity: 3 }], reason: 'x' }, customer)).rejects.toThrow('at most 2');
    await expect(h.exchanges.request({ orderNumber: order.number, email: 'someone@else.com', items: [{ orderItemId: shirt.id, quantity: 1 }], reason: 'x' }, undefined)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // Guest path with the order email works.
    const guestEx = await h.exchanges.request({ orderNumber: order.number, email: 'ADA@example.com', items: [{ orderItemId: shirt.id, quantity: 2 }], reason: 'Wrong size' }, undefined);
    expect(guestEx.status).toBe('REQUESTED');
    await expect(h.exchanges.request({ orderNumber: order.number, items: [{ orderItemId: shirt.id, quantity: 1 }], reason: 'x' }, customer)).rejects.toThrow('already has an exchange');
    // Declining frees the quantity again and resets the order status.
    await h.exchanges.decline(guestEx.id, 'Worn');
    expect((await h.ordersRepo.findById(order.id))?.status).toBe('DELIVERED');
    expect(h.email.sent.at(-1)?.html).toContain('Worn');
    h.clock.advance(8 * 86_400_000);
    await expect(h.exchanges.request({ orderNumber: order.number, items: [{ orderItemId: shirt.id, quantity: 1 }], reason: 'x' }, customer)).rejects.toThrow('7-day exchange window');
  });

  it('cannot request an exchange before delivery', async () => {
    const h = harness();
    const cart = await h.carts.resolve({ userId: customer.id }, { create: true });
    await h.carts.addLine(cart, 'shirt-l', 1);
    const { order } = await h.checkout.checkout({ userId: customer.id }, dto(), customer);
    const [line] = await h.ordersRepo.items(order.id);
    await expect(h.exchanges.request({ orderNumber: order.number, items: [{ orderItemId: line.id, quantity: 1 }], reason: 'x' }, customer)).rejects.toThrow('once your order has been delivered');
  });
});

describe('admin order status (ADM-3)', () => {
  it('emails the customer on DISPATCHED and sets deliveredAt on DELIVERED', async () => {
    const h = harness();
    const cart = await h.carts.resolve({}, { create: true });
    await h.carts.addLine(cart, 'shirt-l', 1);
    const { order } = await h.checkout.checkout({ token: cart.token }, dto());
    h.setVerify('success', order.amountDueKobo);
    await h.payments.confirm((await h.ordersRepo.findById(order.id))!);
    await expect(h.lifecycle.adminSetStatus(order.id, 'READY_FOR_PICKUP')).rejects.toThrow('Only pickup orders');
    const dispatched = await h.lifecycle.adminSetStatus(order.id, 'DISPATCHED');
    expect(dispatched.status).toBe('DISPATCHED');
    expect(h.email.sent.at(-1)?.subject).toBe(`Order ${order.number} is on its way`);
    const delivered = await h.lifecycle.adminSetStatus(order.id, 'DELIVERED');
    expect(delivered.deliveredAt).toBe(h.clock.now().toISOString());
    expect(delivered.exchangeableUntil).toBe(new Date(h.clock.now().getTime() + 7 * 86_400_000).toISOString());
    await expect(h.lifecycle.adminSetStatus(order.id, 'PROCESSING')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cancelling a paid order restocks and returns credit spent', async () => {
    const h = harness();
    await h.creditRepo.add({ email: customer.email, amountKobo: 1_000_000, reason: 'EXCHANGE_CREDIT' });
    const cart = await h.carts.resolve({ userId: customer.id }, { create: true });
    await h.carts.addLine(cart, 'shirt-l', 1);
    const { order } = await h.checkout.checkout({ userId: customer.id }, dto({ useCredit: true }), customer);
    h.setVerify('success', order.amountDueKobo);
    await h.payments.confirm((await h.ordersRepo.findById(order.id))!);
    expect(h.w.stock.get('shirt-l')).toBe(4);
    await h.lifecycle.adminSetStatus(order.id, 'CANCELLED');
    expect(h.w.stock.get('shirt-l')).toBe(5);
    expect(await h.credit.balance(customer.email)).toBe(1_000_000);
  });
});
