import { FakeClock } from './fakes';
import { EmailOrderStats, mergeCustomers, queryCustomers, RegisteredCustomer } from '../src/admin/customers/customer-aggregation';
import { AdminCustomersService } from '../src/admin/customers/customers.service';
import type { CustomerAddress, CustomerOrder, CustomersRepository, LedgerEntryRow } from '../src/admin/customers/customers.repository';

const d = (s: string) => new Date(s);
const user = (email: string, over: Partial<RegisteredCustomer> = {}): RegisteredCustomer => ({
  userId: 'usr_' + email.split('@')[0].toLowerCase(),
  email,
  firstName: 'Ada',
  lastName: 'Okafor',
  phone: '+2348030000000',
  verified: true,
  joinedAt: d('2026-09-01T10:00:00Z'),
  ...over,
});
const stats = (email: string, orders: number, totalSpentKobo: number, last: string, over: Partial<EmailOrderStats> = {}): EmailOrderStats => ({
  email,
  orders,
  totalSpentKobo,
  lastOrderAt: d(last),
  lastName: null,
  lastPhone: null,
  ...over,
});

describe('customer aggregation', () => {
  it('merges a registered account with its orders case-insensitively', () => {
    const rows = mergeCustomers([user('Ada@Example.com')], [stats('ada@example.COM', 2, 300_000_00, '2026-10-10T10:00:00Z')]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: 'ada@example.com', registered: true, userId: 'usr_ada', orders: 2, totalSpentKobo: 300_000_00, name: 'Ada Okafor' });
  });

  it('adds guests with paid orders, named from their latest order', () => {
    const rows = mergeCustomers(
      [user('ada@example.com')],
      [stats('kemi@example.com', 1, 95_000_00, '2026-10-12T10:00:00Z', { lastName: 'Kemi Adebayo', lastPhone: '+2348090000000' })],
    );
    const kemi = rows.find((r) => r.email === 'kemi@example.com')!;
    expect(kemi).toMatchObject({ registered: false, userId: null, verified: false, joinedAt: null, name: 'Kemi Adebayo', phone: '+2348090000000', orders: 1 });
    expect(rows.find((r) => r.email === 'ada@example.com')).toMatchObject({ orders: 0, totalSpentKobo: 0, lastOrderAt: null });
  });

  it('combines stats rows that differ only by case', () => {
    const rows = mergeCustomers(
      [],
      [
        stats('Tolu@x.com', 1, 100, '2026-10-01T10:00:00Z', { lastName: 'Old Name' }),
        stats('tolu@X.com', 2, 200, '2026-10-09T10:00:00Z', { lastName: 'Tolu Bello' }),
      ],
    );
    expect(rows).toEqual([expect.objectContaining({ email: 'tolu@x.com', orders: 3, totalSpentKobo: 300, lastOrderAt: d('2026-10-09T10:00:00Z'), name: 'Tolu Bello' })]);
  });

  it('falls back to the order name when the account has none', () => {
    const rows = mergeCustomers([user('z@x.com', { firstName: '', lastName: '', phone: null })], [stats('z@x.com', 1, 1, '2026-10-01T00:00:00Z', { lastName: 'Zainab Musa', lastPhone: '+2347010000000' })]);
    expect(rows[0]).toMatchObject({ name: 'Zainab Musa', phone: '+2347010000000' });
  });

  it('searches email, name and phone (local or international format) and sorts/paginates', () => {
    const rows = mergeCustomers(
      [user('ada@example.com'), user('ngozi@example.com', { firstName: 'Ngozi', lastName: 'Eze', phone: '+2348021112222', joinedAt: d('2026-10-14T00:00:00Z') })],
      [stats('ada@example.com', 3, 500, '2026-10-01T00:00:00Z'), stats('kemi@example.com', 1, 900, '2026-10-12T00:00:00Z', { lastName: 'Kemi Adebayo' })],
    );
    expect(queryCustomers(rows, { q: 'KEMI', sort: 'recent', page: 1, pageSize: 10 }).items.map((r) => r.email)).toEqual(['kemi@example.com']);
    expect(queryCustomers(rows, { q: '08021112222', sort: 'recent', page: 1, pageSize: 10 }).items.map((r) => r.email)).toEqual(['ngozi@example.com']);
    expect(queryCustomers(rows, { sort: 'recent', page: 1, pageSize: 10 }).items.map((r) => r.email)).toEqual(['kemi@example.com', 'ada@example.com', 'ngozi@example.com']);
    expect(queryCustomers(rows, { sort: 'spent', page: 1, pageSize: 10 }).items[0].email).toBe('kemi@example.com');
    expect(queryCustomers(rows, { sort: 'orders', page: 1, pageSize: 10 }).items[0].email).toBe('ada@example.com');
    const p2 = queryCustomers(rows, { sort: 'spent', page: 2, pageSize: 2 });
    expect(p2).toEqual({ total: 3, items: [expect.objectContaining({ email: 'ngozi@example.com' })] });
  });
});

class InMemoryCustomersRepository implements CustomersRepository {
  constructor(
    public users: RegisteredCustomer[],
    public stats: EmailOrderStats[],
    public ledger: LedgerEntryRow[] = [],
    public orders: (CustomerOrder & { email: string })[] = [],
    public addresses: Record<string, CustomerAddress[]> = {},
  ) {}
  async registered(email?: string) {
    return this.users.filter((u) => !email || u.email.toLowerCase() === email.toLowerCase());
  }
  async paidOrderStats(email?: string) {
    return this.stats.filter((s) => !email || s.email.toLowerCase() === email.toLowerCase());
  }
  async ledgerFor(emails: string[]) {
    const set = new Set(emails.map((e) => e.toLowerCase()));
    return this.ledger.filter((e) => set.has(e.email));
  }
  async ordersFor(email: string) {
    return this.orders.filter((o) => o.email.toLowerCase() === email.toLowerCase());
  }
  async addressesFor(userId: string) {
    return this.addresses[userId] ?? [];
  }
}

describe('AdminCustomersService', () => {
  const clock = new FakeClock(d('2026-10-15T12:00:00Z'));
  const ledger: LedgerEntryRow[] = [
    { id: 'cr1', email: 'ada@example.com', amountKobo: 62_500_00, reason: 'EXCHANGE_CREDIT', orderId: null, exchangeId: 'ex1', createdAt: d('2026-09-10T00:00:00Z'), expiresAt: null },
    { id: 'cr2', email: 'ada@example.com', amountKobo: -20_000_00, reason: 'ORDER_PAYMENT', orderId: 'o2', exchangeId: null, createdAt: d('2026-10-01T00:00:00Z'), expiresAt: null },
  ];

  it('lists merged customers with credit balances for the page', async () => {
    const repo = new InMemoryCustomersRepository([user('Ada@example.com')], [stats('ada@example.com', 2, 1000, '2026-10-01T00:00:00Z'), stats('guest@x.com', 1, 50, '2026-10-02T00:00:00Z')], ledger);
    const out = await new AdminCustomersService(repo, clock).list({ sort: 'recent', page: 1, pageSize: 25 });
    expect(out.total).toBe(2);
    expect(out.items.map((c) => [c.email, c.registered, c.creditBalanceKobo])).toEqual([
      ['guest@x.com', false, 0],
      ['ada@example.com', true, 42_500_00],
    ]);
    expect(out.items[1].joinedAt).toBe('2026-09-01T10:00:00.000Z');
  });

  it('returns a detail with orders, addresses and the ledger newest first; 404 for strangers', async () => {
    const order: CustomerOrder & { email: string } = { id: 'o2', email: 'ADA@example.com', number: 'AP-10600', createdAt: d('2026-10-01T00:00:00Z'), paidAt: d('2026-10-01T00:01:00Z'), status: 'PAID', provider: 'PAYSTACK', totalKobo: 1000, itemCount: 2 };
    const addr: CustomerAddress = { id: 'adr1', fullName: 'Ada Okafor', phone: '+234', state: 'Lagos', lga: 'Eti-Osa', area: 'Lekki', street: '1 Road', landmark: '' };
    const repo = new InMemoryCustomersRepository([user('ada@example.com')], [stats('ada@example.com', 1, 1000, '2026-10-01T00:01:00Z')], ledger, [order], { usr_ada: [addr] });
    const svc = new AdminCustomersService(repo, clock);
    const out = await svc.detail('Ada@Example.com');
    expect(out).toMatchObject({ email: 'ada@example.com', registered: true, orders: 1, creditBalanceKobo: 42_500_00 });
    expect(out.orderList.map((o) => o.number)).toEqual(['AP-10600']);
    expect(out.addresses).toEqual([addr]);
    expect(out.credit.map((c) => c.id)).toEqual(['cr2', 'cr1']);
    await expect(svc.detail('nobody@x.com')).rejects.toThrow('Customer not found');
  });
});
