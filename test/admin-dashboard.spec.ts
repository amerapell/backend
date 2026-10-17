import { FakeClock } from './fakes';
import { DashboardService } from '../src/admin/dashboard/dashboard.service';
import type { CustomerCounts, DashboardData, DashboardRepository, RecentOrder } from '../src/admin/dashboard/dashboard.repository';
import { lagosDateKey, periodWindows, PaidOrderFact, salesByDay, salesByProvider, summarizePeriods } from '../src/admin/dashboard/dashboard-metrics';

const d = (s: string) => new Date(s);
const fact = (at: string, totalKobo: number, email = 'a@x.com', provider: string | null = 'PAYSTACK'): PaidOrderFact => ({ at: d(at), totalKobo, email, provider });

/** In-memory repository: filters facts by window like the SQL does. */
class InMemoryDashboardRepository implements DashboardRepository {
  calls: { from: Date; to: Date }[] = [];
  constructor(public facts: PaidOrderFact[] = [], public latest: Date | null = null) {}
  async load(): Promise<DashboardData> {
    return { todaySalesKobo: 1, ordersToFulfil: 2, pendingExchanges: 3, bestSellers: [], lowStock: [], ordersBySource: [] };
  }
  async paidOrderFacts(from: Date, to: Date) {
    this.calls.push({ from, to });
    return this.facts.filter((f) => f.at >= from && f.at <= to);
  }
  async recentOrders(): Promise<RecentOrder[]> {
    return [];
  }
  async customerCounts(): Promise<CustomerCounts> {
    return { total: 4, newLast7: 1, verified: 2, payingCustomers: 3, repeatCustomers: 1 };
  }
  async latestOrderAt() {
    return this.latest;
  }
}

describe('dashboard date bucketing (Lagos, UTC+1)', () => {
  it('maps instants to Lagos calendar days', () => {
    expect(lagosDateKey(d('2026-10-14T22:59:59Z'))).toBe('2026-10-14');
    expect(lagosDateKey(d('2026-10-14T23:00:00Z'))).toBe('2026-10-15'); // 00:00 WAT
  });

  it('today starts at Lagos midnight (23:00Z the day before)', () => {
    const now = d('2026-10-15T00:30:00Z'); // 01:30 WAT on the 15th
    const w = periodWindows(now);
    expect(w.today.current.from.toISOString()).toBe('2026-10-14T23:00:00.000Z');
    expect(w.today.previous.from.toISOString()).toBe('2026-10-13T23:00:00.000Z');
    expect(w.today.previous.to.toISOString()).toBe('2026-10-14T00:30:00.000Z');
    expect(w.last7.current.from.toISOString()).toBe('2026-10-08T23:00:00.000Z');
    expect(w.last7.previous.from.toISOString()).toBe('2026-10-01T23:00:00.000Z');
    expect(w.last30.previous.from.toISOString()).toBe('2026-08-16T23:00:00.000Z');
  });

  it('an order at 23:30Z counts towards the next Lagos day', () => {
    const now = d('2026-10-15T12:00:00Z');
    const facts = [fact('2026-10-14T23:30:00Z', 10_000_00), fact('2026-10-14T22:30:00Z', 5_000_00)];
    const p = summarizePeriods(facts, now);
    expect(p.today.salesKobo).toBe(10_000_00);
    // yesterday 23:30 WAT is after 13:00 WAT, so it is outside the like-for-like "yesterday so far" window
    expect(p.today.previous.salesKobo).toBe(0);
    const days = salesByDay(facts, now, 30);
    expect(days.at(-1)).toEqual({ date: '2026-10-15', salesKobo: 10_000_00, orders: 1 });
    expect(days.at(-2)).toEqual({ date: '2026-10-14', salesKobo: 5_000_00, orders: 1 });
  });

  it('zero-fills all 30 days, oldest first, ending today', () => {
    const now = d('2026-10-15T12:00:00Z');
    const days = salesByDay([fact('2026-10-01T10:00:00Z', 1_000_00), fact('2026-09-01T10:00:00Z', 9_999_00)], now, 30);
    expect(days).toHaveLength(30);
    expect(days[0].date).toBe('2026-09-16');
    expect(days[29].date).toBe('2026-10-15');
    expect(days.filter((x) => x.orders > 0)).toEqual([{ date: '2026-10-01', salesKobo: 1_000_00, orders: 1 }]);
    expect(days.reduce((n, x) => n + x.salesKobo, 0)).toBe(1_000_00);
  });

  it('compares like for like: today so far vs yesterday up to the same time', () => {
    const now = d('2026-10-15T09:00:00Z'); // 10:00 WAT
    const facts = [
      fact('2026-10-15T08:00:00Z', 100_00, 'a@x.com'),
      fact('2026-10-15T08:30:00Z', 300_00, 'A@X.com'), // same customer, different case
      fact('2026-10-14T08:00:00Z', 200_00, 'b@x.com'), // yesterday, before 10:00 WAT → previous
      fact('2026-10-14T15:00:00Z', 999_00, 'c@x.com'), // yesterday afternoon → not in previous
    ];
    const p = summarizePeriods(facts, now);
    expect(p.today).toMatchObject({ salesKobo: 400_00, orders: 2, avgOrderKobo: 200_00, paidCustomers: 1 });
    expect(p.today.previous).toEqual({ salesKobo: 200_00, orders: 1, avgOrderKobo: 200_00, paidCustomers: 1 });
    expect(p.last7.salesKobo).toBe(400_00 + 200_00 + 999_00);
  });

  it('previous 7/30-day windows do not overlap the current ones', () => {
    const now = d('2026-10-15T12:00:00Z');
    // current 7d starts 2026-10-08T23:00Z; previous 7d = [2026-10-01T23:00Z, 2026-10-08T12:00Z]
    const facts = [fact('2026-10-08T23:00:00Z', 1), fact('2026-10-08T12:00:00Z', 2), fact('2026-10-01T23:00:00Z', 4), fact('2026-10-01T22:59:59Z', 8), fact('2026-10-08T15:00:00Z', 16)];
    const p = summarizePeriods(facts, now);
    expect(p.last7.salesKobo).toBe(1);
    expect(p.last7.previous.salesKobo).toBe(2 + 4);
  });

  it('empty periods average to zero, not NaN', () => {
    const p = summarizePeriods([], d('2026-10-15T12:00:00Z'));
    expect(p.last30).toEqual({ salesKobo: 0, orders: 0, avgOrderKobo: 0, paidCustomers: 0, previous: { salesKobo: 0, orders: 0, avgOrderKobo: 0, paidCustomers: 0 } });
  });

  it('groups sales by provider within the window', () => {
    const now = d('2026-10-15T12:00:00Z');
    const w = periodWindows(now).last30.current;
    const rows = salesByProvider([fact('2026-10-10T10:00:00Z', 500, 'a', 'BACHS'), fact('2026-10-11T10:00:00Z', 300, 'a', 'PAYSTACK'), fact('2026-10-12T10:00:00Z', 300, 'a', 'PAYSTACK'), fact('2026-08-01T10:00:00Z', 9999, 'a', 'CREDIT')], w);
    expect(rows).toEqual([{ provider: 'PAYSTACK', orders: 2, salesKobo: 600 }, { provider: 'BACHS', orders: 1, salesKobo: 500 }]);
  });
});

describe('DashboardService', () => {
  it('keeps the original fields and adds the new ones', async () => {
    const clock = new FakeClock(d('2026-10-15T12:00:00Z'));
    const repo = new InMemoryDashboardRepository([fact('2026-10-15T10:00:00Z', 185_000_00), fact('2026-10-05T10:00:00Z', 50_000_00, 'b@x.com', 'BACHS')], d('2026-10-15T10:00:00Z'));
    const out = await new DashboardService(repo, clock).get();
    expect(out).toMatchObject({ todaySalesKobo: 1, ordersToFulfil: 2, pendingExchanges: 3, bestSellers: [], lowStock: [], ordersBySource: [] });
    expect(out.periods.today.salesKobo).toBe(185_000_00);
    expect(out.periods.last30).toMatchObject({ salesKobo: 235_000_00, orders: 2, paidCustomers: 2 });
    expect(out.salesByDay).toHaveLength(30);
    expect(out.byProvider.map((p) => p.provider)).toEqual(['PAYSTACK', 'BACHS']);
    expect(out.customers.total).toBe(4);
    expect(out.latestOrderAt).toBe('2026-10-15T10:00:00.000Z');
    // fetches exactly back to the start of the previous 30-day window
    expect(repo.calls[0].from.toISOString()).toBe('2026-08-16T23:00:00.000Z');
  });
});
