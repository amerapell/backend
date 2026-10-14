import { toAdminExchangeDetail } from '../src/exchanges/exchange-presenter';
import type { ExchangeAggregate } from '../src/exchanges/exchanges.repository';
import type { OrderItemRow, OrderRow } from '../src/db/schema';
import { refreshCookieOptions } from '../src/auth/auth.controller';
import { PaystackProvider } from '../src/payments/paystack/paystack.provider';
import { testConfig } from './fakes';

const DAY = 86_400_000;
const delivered = new Date('2026-10-01T10:00:00Z');

function agg(createdAt: Date): ExchangeAggregate {
  return {
    exchange: {
      id: 'ex1',
      number: 'EX-2001',
      orderId: 'o1',
      userId: null,
      email: 'ada@example.com',
      status: 'REQUESTED',
      reason: 'Wrong size',
      note: 'Too loose',
      photoUrls: ['https://res.cloudinary.com/x/a.jpg'],
      creditKobo: 0,
      createdAt,
      updatedAt: createdAt,
    },
    orderNumber: 'AP-10001',
    customerName: 'Ada Okafor',
    items: [{ orderItemId: 'oi1', name: 'Silk shirt', quantity: 1, valueKobo: 5_000_000, variantId: 'v1' }],
    history: [{ id: 'h1', exchangeId: 'ex1', status: 'REQUESTED', note: 'Too loose', at: createdAt }],
  };
}

const order = {
  id: 'o1',
  number: 'AP-10001',
  status: 'EXCHANGE_REQUESTED',
  email: 'ada@example.com',
  phone: '+2348030000000',
  address: null,
  deliveredAt: delivered,
} as unknown as OrderRow;

const items = [
  { id: 'oi1', orderId: 'o1', sku: 'SH-NV-M', name: 'Silk shirt', number: 'No. 012', colour: 'Navy', size: 'M', imageUrl: 'https://res.cloudinary.com/x/s.jpg', paidUnitKobo: 5_000_000 },
] as unknown as OrderItemRow[];

describe('admin exchange detail (GET /admin/exchanges/:id)', () => {
  it('adds customer contact, linked order, item details and the exchange window', () => {
    const d = toAdminExchangeDetail(agg(new Date(delivered.getTime() + 2 * DAY)), order, items, 7);
    expect(d.orderId).toBe('o1');
    expect(d.customer).toEqual({ name: 'Ada Okafor', email: 'ada@example.com', phone: '+2348030000000', userId: null });
    expect(d.items[0]).toMatchObject({ imageUrl: 'https://res.cloudinary.com/x/s.jpg', colour: 'Navy', size: 'M', sku: 'SH-NV-M', paidUnitKobo: 5_000_000, valueKobo: 5_000_000 });
    expect(d.deliveredAt).toBe(delivered.toISOString());
    expect(d.exchangeableUntil).toBe(new Date(delivered.getTime() + 7 * DAY).toISOString());
    expect(d.requestedWithinWindow).toBe(true);
    expect(d.email).toBe('ada@example.com');
  });

  it('flags a request made after the window closed', () => {
    expect(toAdminExchangeDetail(agg(new Date(delivered.getTime() + 8 * DAY)), order, items, 7).requestedWithinWindow).toBe(false);
  });
});

describe('no refunds (PAY-7)', () => {
  it('payment providers expose no refund method', () => {
    const p = new PaystackProvider(testConfig(), (async () => new Response('{}')) as typeof fetch) as unknown as Record<string, unknown>;
    expect(p.refund).toBeUndefined();
  });
});

describe('refresh cookie (first-party via the frontend /api/v1 rewrite)', () => {
  it('is httpOnly, SameSite=Lax, host-only and scoped to /api/v1/auth; Secure in production', () => {
    const prod = refreshCookieOptions(testConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x', JWT_ACCESS_SECRET: 'a', JWT_REFRESH_SECRET: 'b' }));
    expect(prod).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/api/v1/auth' });
    expect(prod.domain).toBeUndefined();
    expect(refreshCookieOptions(testConfig()).secure).toBe(false);
  });
});
