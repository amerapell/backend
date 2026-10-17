import { Inject, Injectable } from '@nestjs/common';
import { addDays, CLOCK, Clock, startOfLagosDay } from '../../common/clock';
import { DASHBOARD_REPOSITORY, DashboardRepository } from './dashboard.repository';
import { earliestNeeded, periodWindows, salesByDay, salesByProvider, summarizePeriods } from './dashboard-metrics';

const RECENT_ORDERS = 10;

/** ADM-5 dashboard: the original tiles plus period KPIs, a 30-day series, recent orders and customer counts. */
@Injectable()
export class DashboardService {
  constructor(
    @Inject(DASHBOARD_REPOSITORY) private readonly repo: DashboardRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async get() {
    const now = this.clock.now();
    const windows = periodWindows(now);
    const [base, facts, recentOrders, customers, latestOrderAt] = await Promise.all([
      this.repo.load(startOfLagosDay(now), addDays(now, -30)),
      this.repo.paidOrderFacts(earliestNeeded(now), now),
      this.repo.recentOrders(RECENT_ORDERS),
      this.repo.customerCounts(windows.last7.current.from),
      this.repo.latestOrderAt(),
    ]);
    return {
      ...base,
      periods: summarizePeriods(facts, now),
      salesByDay: salesByDay(facts, now, 30),
      recentOrders,
      customers,
      byProvider: salesByProvider(facts, windows.last30.current),
      latestOrderAt: latestOrderAt ? latestOrderAt.toISOString() : null,
      generatedAt: now.toISOString(),
    };
  }
}
