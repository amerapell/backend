import { Get } from '@nestjs/common';
import { AdminController } from '../admin-controller.decorator';
import { DashboardService } from './dashboard.service';

/** ADM-5. Best sellers, orders-by-source and sales-by-provider cover the last 30 days. */
@AdminController('dashboard')
export class AdminDashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  get() {
    return this.dashboard.get();
  }
}
