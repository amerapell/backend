import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CLOCK, Clock } from '../../common/clock';
import { computeCreditBalance } from '../../credit/credit-ledger';
import { CustomerSort, CustomerSummary, mergeCustomers, normaliseEmail, queryCustomers } from './customer-aggregation';
import { CUSTOMERS_REPOSITORY, CustomersRepository, LedgerEntryRow } from './customers.repository';

export interface CustomerListQuery {
  q?: string;
  sort: CustomerSort;
  page: number;
  pageSize: number;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Admin Customers: registered accounts + guest checkout emails, merged by lowercased email. */
@Injectable()
export class AdminCustomersService {
  constructor(
    @Inject(CUSTOMERS_REPOSITORY) private readonly repo: CustomersRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Merge/filter/sort happen in memory over one row per customer (two aggregate queries). Fine for a single
   * boutique's customer base; move to SQL if it grows past tens of thousands.
   */
  async list(query: CustomerListQuery) {
    const [registered, stats] = await Promise.all([this.repo.registered(), this.repo.paidOrderStats()]);
    const { items, total } = queryCustomers(mergeCustomers(registered, stats), query);
    const balances = this.balances(await this.repo.ledgerFor(items.map((c) => c.email)));
    return {
      items: items.map((c) => this.present(c, balances.get(c.email) ?? 0)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async detail(rawEmail: string) {
    const email = normaliseEmail(rawEmail);
    const [registered, stats, orders, ledger] = await Promise.all([
      this.repo.registered(email),
      this.repo.paidOrderStats(email),
      this.repo.ordersFor(email),
      this.repo.ledgerFor([email]),
    ]);
    const merged = mergeCustomers(registered, stats)[0];
    if (!merged && !orders.length) throw new NotFoundException('Customer not found');
    // A guest whose orders were never paid still gets a page (so links from unpaid orders work).
    const customer: CustomerSummary = merged ?? {
      email,
      userId: null,
      name: email,
      phone: null,
      registered: false,
      verified: false,
      joinedAt: null,
      orders: 0,
      totalSpentKobo: 0,
      lastOrderAt: null,
    };
    const addresses = customer.userId ? await this.repo.addressesFor(customer.userId) : [];
    return {
      ...this.present(customer, this.balances(ledger).get(email) ?? 0),
      orderList: orders.map((o) => ({
        id: o.id,
        number: o.number,
        createdAt: o.createdAt.toISOString(),
        paidAt: iso(o.paidAt),
        status: o.status,
        provider: o.provider,
        totalKobo: o.totalKobo,
        itemCount: o.itemCount,
      })),
      addresses,
      credit: ledger
        .slice()
        .reverse()
        .map((e) => ({
          id: e.id,
          amountKobo: e.amountKobo,
          reason: e.reason,
          orderId: e.orderId,
          exchangeId: e.exchangeId,
          createdAt: e.createdAt.toISOString(),
          expiresAt: iso(e.expiresAt),
        })),
    };
  }

  private balances(ledger: LedgerEntryRow[]): Map<string, number> {
    const byEmail = new Map<string, LedgerEntryRow[]>();
    for (const e of ledger) {
      const k = normaliseEmail(e.email);
      byEmail.set(k, [...(byEmail.get(k) ?? []), e]);
    }
    const now = this.clock.now();
    return new Map([...byEmail].map(([k, entries]) => [k, computeCreditBalance(entries, now)]));
  }

  private present(c: CustomerSummary, creditBalanceKobo: number) {
    return {
      email: c.email,
      userId: c.userId,
      name: c.name,
      phone: c.phone,
      registered: c.registered,
      verified: c.verified,
      joinedAt: iso(c.joinedAt),
      orders: c.orders,
      totalSpentKobo: c.totalSpentKobo,
      lastOrderAt: iso(c.lastOrderAt),
      creditBalanceKobo,
    };
  }
}
