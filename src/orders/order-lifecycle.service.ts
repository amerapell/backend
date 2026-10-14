import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CLOCK, Clock } from '../common/clock';
import type { Order, OrderStatus, PaymentStatus } from '../common/contract';
import type { OrderRow } from '../db/schema';
import { CartService } from '../cart/cart.service';
import { CreditService } from '../credit/credit.service';
import { NotificationsService } from '../email/notifications.service';
import { ORDERS_REPOSITORY, OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';
import { canAdminSetStatus, NOTIFY_ON, PAID_STATUSES } from './order-status';

/** Write side of the order lifecycle: paid, cancelled/expired, and admin status changes. */
@Injectable()
export class OrderLifecycleService {
  private readonly logger = new Logger('OrderLifecycle');

  constructor(
    @Inject(ORDERS_REPOSITORY) private readonly repo: OrdersRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly orders: OrdersService,
    private readonly credit: CreditService,
    private readonly carts: CartService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * PAY-3/PAY-5: called only after server-side verification. Idempotent — a second call for an already-paid
   * order is a no-op and returns false (no double stock decrement, no duplicate emails).
   */
  async markPaid(order: OrderRow): Promise<boolean> {
    const { changed, wasCancelled } = await this.repo.markPaid(order.id, this.clock.now());
    if (!changed) return false;
    if (wasCancelled) {
      this.logger.warn(`Order ${order.number} was paid after its stock hold expired — fulfil manually if stock ran out`);
      await this.credit.reapplyOrderSpend(order.id, order.email, order.userId, order.creditAppliedKobo);
    }
    const fresh = (await this.repo.findById(order.id)) as OrderRow;
    const items = await this.repo.items(order.id);
    if (fresh.cartId) {
      await this.carts
        .removePurchased(
          fresh.cartId,
          items.map((i) => i.variantId).filter((v): v is string => !!v),
        )
        .catch((e: Error) => this.logger.warn(`Cart cleanup failed: ${e.message}`));
    }
    await this.notifications.orderPaid(await this.orders.present(fresh));
    return true;
  }

  /** PAY-4: payment failed or hold expired — release stock and give back any credit used. */
  async cancelUnpaid(order: OrderRow, paymentStatus: PaymentStatus): Promise<boolean> {
    const changed = await this.repo.cancelUnpaid(order.id, paymentStatus, this.clock.now());
    if (changed) await this.credit.reverseOrderSpend(order.id);
    return changed;
  }

  async recordPaymentFailure(order: OrderRow, status: PaymentStatus): Promise<void> {
    if (order.status === 'PENDING_PAYMENT') await this.repo.setPayment(order.id, { paymentStatus: status });
  }

  /** ADM-3: admin status change; emails customer on DISPATCHED / READY_FOR_PICKUP / DELIVERED. */
  async adminSetStatus(orderId: string, status: OrderStatus): Promise<Order> {
    const order = await this.repo.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');
    if (order.status === status) return this.orders.present(order);
    if (!canAdminSetStatus(order.status, status)) {
      throw new BadRequestException(`Cannot change an order from ${order.status} to ${status}`);
    }
    if (status === 'READY_FOR_PICKUP' && order.zoneCode !== 'PICKUP') {
      throw new BadRequestException('Only pickup orders can be marked ready for pickup');
    }
    const now = this.clock.now();
    if (status === 'CANCELLED') {
      if (order.status === 'PENDING_PAYMENT') {
        await this.cancelUnpaid(order, 'FAILED');
        return this.orders.byId(order.id);
      }
      if (PAID_STATUSES.includes(order.status)) {
        // Store cannot fulfil a paid order: stock goes back; any credit used is returned as credit.
        // PAY-7: no provider refunds — the store never refunds money (exchange credit only).
        await this.repo.restock(order.id);
        await this.credit.reverseOrderSpend(order.id);
      }
      await this.repo.updateStatus(order.id, 'CANCELLED', { cancelledAt: now });
    } else {
      await this.repo.updateStatus(order.id, status, status === 'DELIVERED' ? { deliveredAt: now } : {});
    }
    const updated = await this.orders.byId(order.id);
    if (NOTIFY_ON.includes(status)) await this.notifications.orderStatusChanged(updated);
    return updated;
  }
}
