import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PaymentsService } from './payments.service';

/** PAY-4: every minute, release holds on unpaid orders older than 15 minutes. */
@Injectable()
export class StockHoldScheduler {
  private readonly logger = new Logger('StockHoldScheduler');
  private running = false;

  constructor(private readonly payments: PaymentsService) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'expire-stock-holds' })
  async run(): Promise<void> {
    if (this.running || process.env.DISABLE_CRON === 'true') return;
    this.running = true;
    try {
      const n = await this.payments.expireStaleOrders();
      if (n) this.logger.log(`Released stock holds for ${n} expired order(s)`);
    } catch (err) {
      this.logger.error(`Hold expiry failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
