import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Order } from '../common/contract';
import type { OrderRow } from '../db/schema';
import { SettingsService } from '../settings/settings.service';
import { ORDERS_REPOSITORY, OrdersRepository } from './orders.repository';
import { toOrder } from './order-presenter';

/** Read side of orders: presenting, customer history and guest lookup. */
@Injectable()
export class OrdersService {
  constructor(
    @Inject(ORDERS_REPOSITORY) private readonly repo: OrdersRepository,
    private readonly settings: SettingsService,
  ) {}

  async present(order: OrderRow): Promise<Order> {
    const [items, s] = await Promise.all([this.repo.items(order.id), this.settings.get()]);
    return toOrder(order, items, s.exchangeWindowDays);
  }

  async presentMany(rows: OrderRow[]): Promise<Order[]> {
    const [items, s] = await Promise.all([this.repo.itemsFor(rows.map((r) => r.id)), this.settings.get()]);
    return rows.map((o) =>
      toOrder(
        o,
        items.filter((i) => i.orderId === o.id),
        s.exchangeWindowDays,
      ),
    );
  }

  async byId(id: string): Promise<Order> {
    const o = await this.repo.findById(id);
    if (!o) throw new NotFoundException('Order not found');
    return this.present(o);
  }

  async forUser(userId: string): Promise<Order[]> {
    return this.presentMany(await this.repo.listForUser(userId));
  }

  async forUserByNumber(userId: string, number: string): Promise<Order> {
    const o = await this.repo.findByNumber(number);
    if (!o || o.userId !== userId) throw new NotFoundException('Order not found');
    return this.present(o);
  }

  /** ACC-4: guest order lookup by number + email (same 404 for both mismatches). */
  async lookup(number: string, email: string): Promise<Order> {
    const o = await this.repo.findByNumber(number);
    if (!o || o.email.toLowerCase() !== email.trim().toLowerCase() || o.status === 'PENDING_PAYMENT') {
      throw new NotFoundException('We could not find an order with that number and email');
    }
    return this.present(o);
  }
}
