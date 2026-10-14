import { Get, Inject } from '@nestjs/common';
import { addDays, CLOCK, Clock, startOfLagosDay } from '../../common/clock';
import { AdminController } from '../admin-controller.decorator';
import { DASHBOARD_REPOSITORY, DashboardRepository } from './dashboard.repository';

/** ADM-5. Best sellers and orders-by-source cover the last 30 days. */
@AdminController('dashboard')
export class AdminDashboardController {
  constructor(
    @Inject(DASHBOARD_REPOSITORY) private readonly repo: DashboardRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get()
  get() {
    const now = this.clock.now();
    return this.repo.load(startOfLagosDay(now), addDays(now, -30));
  }
}
