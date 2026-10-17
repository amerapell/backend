import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CLOCK, Clock } from '../common/clock';
import type { AuthUser } from '../common/auth-types';
import type { AdminExchange, AdminExchangeDetail, Exchange, ExchangeStatus, OrderStatus } from '../common/contract';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../email/notifications.service';
import { CreditService } from '../credit/credit.service';
import { EMAIL_VERIFICATION_LOOKUP, EmailVerificationLookup } from '../credit/email-verification.lookup';
import { ORDERS_REPOSITORY, OrdersRepository } from '../orders/orders.repository';
import { EXCHANGES_REPOSITORY, ExchangesRepository } from './exchanges.repository';
import { toAdminExchange, toAdminExchangeDetail, toExchange } from './exchange-presenter';
import { assertExchangeTransition, InvalidTransitionError, isWithinExchangeWindow } from './exchange-status';

export interface ExchangeRequestInput {
  orderNumber: string;
  email?: string;
  items: { orderItemId: string; quantity: number }[];
  reason: string;
  note?: string;
  photoUrls?: string[];
}

const EXCHANGEABLE_ORDER_STATUSES: OrderStatus[] = ['DELIVERED', 'EXCHANGE_REQUESTED', 'EXCHANGED'];
const OPEN: ExchangeStatus[] = ['REQUESTED', 'APPROVED', 'ITEM_RECEIVED', 'CREDIT_ISSUED'];

/** EXC-1..8: exchange-only returns. Credit, never cash. */
@Injectable()
export class ExchangesService {
  constructor(
    @Inject(EXCHANGES_REPOSITORY) private readonly repo: ExchangesRepository,
    @Inject(ORDERS_REPOSITORY) private readonly orders: OrdersRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly credit: CreditService,
    private readonly notifications: NotificationsService,
    @Inject(EMAIL_VERIFICATION_LOOKUP) private readonly verification: EmailVerificationLookup,
  ) {}

  async request(input: ExchangeRequestInput, user: AuthUser | undefined): Promise<Exchange> {
    const order = await this.orders.findByNumber(input.orderNumber);
    const ownsByAccount = !!order && !!user && user.role === 'CUSTOMER' && order.userId === user.id;
    const ownsByEmail = !!order && !!input.email && order.email.toLowerCase() === input.email.trim().toLowerCase();
    if (!order || (!ownsByAccount && !ownsByEmail)) throw new NotFoundException('Order not found');

    const { exchangeWindowDays } = await this.settings.get();
    if (!EXCHANGEABLE_ORDER_STATUSES.includes(order.status) || !order.deliveredAt) {
      throw new BadRequestException('Exchanges can be requested once your order has been delivered');
    }
    if (!isWithinExchangeWindow(order.deliveredAt, exchangeWindowDays, this.clock.now())) {
      throw new BadRequestException(`The ${exchangeWindowDays}-day exchange window for this order has closed`);
    }
    if (!input.items.length) throw new BadRequestException('Choose at least one item to exchange');

    const [orderItems, requested] = await Promise.all([this.orders.items(order.id), this.repo.requestedQuantities(order.id)]);
    const merged = new Map<string, number>();
    for (const i of input.items) merged.set(i.orderItemId, (merged.get(i.orderItemId) ?? 0) + i.quantity);
    const lines = [...merged.entries()].map(([orderItemId, quantity]) => {
      const item = orderItems.find((oi) => oi.id === orderItemId);
      if (!item) throw new BadRequestException('One of the items is not part of this order');
      if (!item.exchangeable) throw new BadRequestException(`${item.name} is not exchangeable`);
      const remaining = item.quantity - (requested.get(item.id) ?? 0);
      if (quantity < 1 || quantity > remaining) {
        throw new BadRequestException(remaining <= 0 ? `${item.name} already has an exchange request` : `You can exchange at most ${remaining} × ${item.name}`);
      }
      return { orderItemId, quantity, valueKobo: item.paidUnitKobo * quantity };
    });

    const id = await this.repo.create({
      orderId: order.id,
      userId: order.userId,
      email: order.email.toLowerCase(),
      reason: input.reason.trim(),
      note: input.note?.trim() || null,
      photoUrls: input.photoUrls ?? [],
      items: lines,
    });
    if (order.status !== 'EXCHANGE_REQUESTED') await this.orders.updateStatus(order.id, 'EXCHANGE_REQUESTED');
    const ex = await this.get(id);
    await this.notifications.exchangeRequested(ex, order.email);
    return ex;
  }

  async get(id: string): Promise<Exchange> {
    const agg = await this.repo.load(id);
    if (!agg) throw new NotFoundException('Exchange not found');
    return toExchange(agg);
  }

  /** Exchanges on the account, plus guest exchanges placed with its email once that email is verified. */
  async forCustomer(user: AuthUser): Promise<Exchange[]> {
    const email = (await this.verification.isVerified(user.id)) ? user.email : null;
    return (await this.repo.loadMany(await this.repo.idsForCustomer(user.id, email))).map(toExchange);
  }

  async adminList(status?: ExchangeStatus): Promise<AdminExchange[]> {
    return (await this.repo.loadMany(await this.repo.idsForAdmin(status))).map(toAdminExchange);
  }

  /** ADM: single exchange with customer contact, linked order, delivery window and item details. */
  async adminDetail(id: string): Promise<AdminExchangeDetail> {
    const agg = await this.repo.load(id);
    if (!agg) throw new NotFoundException('Exchange not found');
    const [order, items, { exchangeWindowDays }] = await Promise.all([
      this.orders.findById(agg.exchange.orderId),
      this.orders.items(agg.exchange.orderId),
      this.settings.get(),
    ]);
    if (!order) throw new NotFoundException('Order not found');
    return toAdminExchangeDetail(agg, order, items, exchangeWindowDays);
  }

  private async move(id: string, to: ExchangeStatus, note: string | null) {
    const agg = await this.repo.load(id);
    if (!agg) throw new NotFoundException('Exchange not found');
    try {
      assertExchangeTransition(agg.exchange.status, to);
    } catch (e) {
      if (e instanceof InvalidTransitionError) throw new BadRequestException(e.message);
      throw e;
    }
    if (!(await this.repo.transition(id, agg.exchange.status, to, note))) {
      throw new ConflictException('This exchange was updated by someone else — refresh and try again');
    }
    return agg;
  }

  /** Re-derives the order status from its exchanges after a terminal change. */
  private async syncOrderStatus(orderId: string): Promise<void> {
    const statuses = await this.repo.statusesForOrder(orderId);
    if (statuses.some((s) => OPEN.includes(s))) return this.orders.updateStatus(orderId, 'EXCHANGE_REQUESTED');
    if (statuses.includes('COMPLETED')) return this.orders.updateStatus(orderId, 'EXCHANGED');
    return this.orders.updateStatus(orderId, 'DELIVERED');
  }

  async approve(id: string, note?: string): Promise<Exchange> {
    const agg = await this.move(id, 'APPROVED', note ?? null);
    const ex = await this.get(id);
    await this.notifications.exchangeApproved(ex, agg.exchange.email);
    return ex;
  }

  async decline(id: string, note?: string): Promise<Exchange> {
    const agg = await this.move(id, 'DECLINED', note ?? null);
    await this.syncOrderStatus(agg.exchange.orderId);
    const ex = await this.get(id);
    await this.notifications.exchangeDeclined(ex, agg.exchange.email);
    return ex;
  }

  /** EXC-4: item received → restock + credit equal to what was paid, in one admin action. */
  async receive(id: string, note?: string): Promise<Exchange> {
    const agg = await this.move(id, 'ITEM_RECEIVED', note ?? null);
    await this.repo.restock(id);
    const creditKobo = agg.items.reduce((n, i) => n + i.valueKobo, 0);
    await this.repo.setCredit(id, creditKobo);
    const { balanceKobo, expiresAt } = await this.credit.issueForExchange(agg.exchange.email, agg.exchange.userId, creditKobo, id, agg.exchange.orderId);
    await this.repo.transition(id, 'ITEM_RECEIVED', 'CREDIT_ISSUED', null);
    const ex = await this.get(id);
    await this.notifications.creditIssued(ex, agg.exchange.email, balanceKobo, expiresAt);
    return ex;
  }

  async complete(id: string, note?: string): Promise<Exchange> {
    const agg = await this.move(id, 'COMPLETED', note ?? null);
    await this.syncOrderStatus(agg.exchange.orderId);
    const ex = await this.get(id);
    await this.notifications.exchangeCompleted(ex, agg.exchange.email);
    return ex;
  }
}
