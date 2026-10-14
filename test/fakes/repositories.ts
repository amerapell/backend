/* In-memory repository fakes: same interfaces the services depend on, no database. */
import { createId } from '@paralleldrive/cuid2';
import type { CreditLedgerRow, ExchangeHistoryRow, ExchangeRow, OrderItemRow, OrderRow } from '../../src/db/schema';
import type { ExchangeStatus, OrderStatus, PaymentStatus, ZoneCode } from '../../src/common/contract';
import { formatExchangeNumber, formatOrderNumber } from '../../src/common/ids';
import { computeCreditBalance } from '../../src/credit/credit-ledger';
import type { CreditRepository, NewCreditEntry } from '../../src/credit/credit.repository';
import { CREDIT_REASONS } from '../../src/credit/credit.service';
import {
  AdminOrderFilter,
  CreateOrderInput,
  CreditUnavailableError,
  InsufficientStockError,
  OrdersRepository,
  OrderWithItems,
} from '../../src/orders/orders.repository';
import type { CartLineRecord, CartRecord, CartRepository, Utm } from '../../src/cart/cart.repository';
import type { PromoRule } from '../../src/cart/cart-math';
import type { InventoryRepository, VariantSnapshot } from '../../src/catalogue/inventory.repository';
import type { ExchangeAggregate, ExchangesRepository, NewExchange } from '../../src/exchanges/exchanges.repository';
import { ACTIVE_EXCHANGE_STATUSES } from '../../src/exchanges/exchange-status';
import type { RecordedEvent, WebhookEventsRepository } from '../../src/payments/webhook-events.repository';
import type { DeliveryZoneRow } from '../../src/db/schema';
import type { Clock } from '../../src/common/clock';

/** Variant stock + holds shared between inventory, orders and exchanges fakes. */
export class Warehouse {
  stock = new Map<string, number>();
  holds: { id: string; variantId: string; orderId: string; quantity: number; expiresAt: Date; releasedAt: Date | null; consumedAt: Date | null }[] = [];
  snapshots = new Map<string, Omit<VariantSnapshot, 'stock' | 'available'>>();

  constructor(private readonly clock: Clock) {}

  addVariant(s: Omit<VariantSnapshot, 'stock' | 'available'>, stock: number) {
    this.snapshots.set(s.variantId, s);
    this.stock.set(s.variantId, stock);
  }

  held(variantId: string, at = this.clock.now()) {
    return this.holds
      .filter((h) => h.variantId === variantId && !h.releasedAt && !h.consumedAt && h.expiresAt > at)
      .reduce((n, h) => n + h.quantity, 0);
  }

  available(variantId: string, at = this.clock.now()) {
    return (this.stock.get(variantId) ?? 0) - this.held(variantId, at);
  }
}

export class InMemoryInventory implements InventoryRepository {
  constructor(private readonly w: Warehouse) {}
  async getSnapshots(ids: string[], now: Date): Promise<VariantSnapshot[]> {
    return ids
      .filter((id) => this.w.snapshots.has(id))
      .map((id) => ({ ...(this.w.snapshots.get(id) as VariantSnapshot), stock: this.w.stock.get(id) ?? 0, available: Math.max(0, this.w.available(id, now)) }));
  }
}

export class InMemoryCreditRepository implements CreditRepository {
  rows: CreditLedgerRow[] = [];
  constructor(private readonly clock: Clock) {}
  async entriesFor(email: string) {
    return this.rows.filter((r) => r.email === email.toLowerCase());
  }
  async entriesForOrder(orderId: string) {
    return this.rows.filter((r) => r.orderId === orderId);
  }
  async add(e: NewCreditEntry) {
    const row: CreditLedgerRow = {
      id: createId(),
      email: e.email.toLowerCase(),
      userId: e.userId ?? null,
      amountKobo: e.amountKobo,
      reason: e.reason,
      orderId: e.orderId ?? null,
      exchangeId: e.exchangeId ?? null,
      expiresAt: e.expiresAt ?? null,
      createdAt: this.clock.now(),
    };
    this.rows.push(row);
    return row;
  }
  async reassignEmail(from: string, to: string) {
    for (const r of this.rows) if (r.email === from) r.email = to;
  }
}

export class InMemoryOrdersRepository implements OrdersRepository {
  orders: OrderRow[] = [];
  itemRows: OrderItemRow[] = [];
  notesList: { orderId: string; id: string; body: string; author: string | null; createdAt: Date }[] = [];
  discountUses = new Map<string, number>();
  private seq = 10501;

  constructor(
    private readonly w: Warehouse,
    private readonly credit: InMemoryCreditRepository,
    private readonly clock: Clock,
  ) {}

  async createWithHolds(input: CreateOrderInput): Promise<OrderWithItems> {
    const short = input.items.filter((i) => this.w.available(i.variantId, input.now) < i.quantity).map((i) => i.variantId);
    if (short.length) throw new InsufficientStockError(short);
    if (input.creditAppliedKobo > 0) {
      const bal = computeCreditBalance(await this.credit.entriesFor(input.creditEmail), input.now);
      if (bal < input.creditAppliedKobo) throw new CreditUnavailableError();
    }
    const order: OrderRow = {
      id: createId(),
      number: formatOrderNumber(this.seq++),
      userId: input.userId,
      cartId: input.cartId,
      email: input.email,
      phone: input.phone,
      status: 'PENDING_PAYMENT',
      zoneCode: input.zoneCode,
      zoneName: input.zoneName,
      address: input.address,
      subtotalKobo: input.subtotalKobo,
      discountKobo: input.discountKobo,
      discountCode: input.discountCode,
      deliveryKobo: input.deliveryKobo,
      creditAppliedKobo: input.creditAppliedKobo,
      totalKobo: input.totalKobo,
      amountDueKobo: input.amountDueKobo,
      paymentProvider: input.paymentProvider,
      paymentReference: null,
      paymentStatus: 'PENDING',
      providerSessionId: null,
      utmSource: input.utm.source,
      utmMedium: input.utm.medium,
      utmCampaign: input.utm.campaign,
      marketingConsent: input.marketingConsent,
      holdExpiresAt: input.holdExpiresAt,
      paidAt: null,
      deliveredAt: null,
      cancelledAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.orders.push(order);
    const items = input.items.map((i) => ({ ...i, id: createId(), orderId: order.id }) as OrderItemRow);
    this.itemRows.push(...items);
    for (const i of input.items) {
      this.w.holds.push({ id: createId(), variantId: i.variantId, orderId: order.id, quantity: i.quantity, expiresAt: input.holdExpiresAt, releasedAt: null, consumedAt: null });
    }
    if (input.creditAppliedKobo > 0) {
      await this.credit.add({ email: input.creditEmail, userId: input.userId, amountKobo: -input.creditAppliedKobo, reason: CREDIT_REASONS.ORDER_SPEND, orderId: order.id });
    }
    return { order: { ...order }, items };
  }

  private o(id: string) {
    return this.orders.find((x) => x.id === id) ?? null;
  }
  async findById(id: string) {
    const o = this.o(id);
    return o ? { ...o } : null;
  }
  async findByNumber(n: string) {
    const o = this.orders.find((x) => x.number === n.toUpperCase());
    return o ? { ...o } : null;
  }
  async findByReference(r: string) {
    const o = this.orders.find((x) => x.paymentReference === r);
    return o ? { ...o } : null;
  }
  async findBySessionId(s: string) {
    const o = this.orders.find((x) => x.providerSessionId === s);
    return o ? { ...o } : null;
  }
  async items(orderId: string) {
    return this.itemRows.filter((i) => i.orderId === orderId);
  }
  async itemsFor(ids: string[]) {
    return this.itemRows.filter((i) => ids.includes(i.orderId));
  }
  async setPayment(id: string, patch: { paymentReference?: string; providerSessionId?: string | null; paymentStatus?: PaymentStatus }) {
    Object.assign(this.o(id) as OrderRow, patch);
  }
  async markPaid(id: string, at: Date) {
    const o = this.o(id);
    if (!o || (o.status !== 'PENDING_PAYMENT' && o.status !== 'CANCELLED')) return { changed: false, wasCancelled: false };
    const wasCancelled = o.status === 'CANCELLED';
    for (const i of this.itemRows.filter((x) => x.orderId === id)) {
      if (i.variantId) this.w.stock.set(i.variantId, Math.max(0, (this.w.stock.get(i.variantId) ?? 0) - i.quantity));
    }
    for (const h of this.w.holds.filter((x) => x.orderId === id && !x.consumedAt)) h.consumedAt = at;
    Object.assign(o, { status: 'PAID', paidAt: at, paymentStatus: 'SUCCEEDED', cancelledAt: null });
    if (o.discountCode) this.discountUses.set(o.discountCode, (this.discountUses.get(o.discountCode) ?? 0) + 1);
    return { changed: true, wasCancelled };
  }
  async cancelUnpaid(id: string, paymentStatus: PaymentStatus, at: Date) {
    const o = this.o(id);
    if (!o || o.status !== 'PENDING_PAYMENT') return false;
    for (const h of this.w.holds.filter((x) => x.orderId === id && !x.releasedAt && !x.consumedAt)) h.releasedAt = at;
    Object.assign(o, { status: 'CANCELLED', paymentStatus, cancelledAt: at });
    return true;
  }
  async updateStatus(id: string, status: OrderStatus, extra: { deliveredAt?: Date; cancelledAt?: Date } = {}) {
    Object.assign(this.o(id) as OrderRow, { status, ...extra });
  }
  async restock(id: string) {
    for (const i of this.itemRows.filter((x) => x.orderId === id)) {
      if (i.variantId) this.w.stock.set(i.variantId, (this.w.stock.get(i.variantId) ?? 0) + i.quantity);
    }
  }
  async findExpiredPending(now: Date) {
    return this.orders.filter((o) => o.status === 'PENDING_PAYMENT' && o.holdExpiresAt && o.holdExpiresAt < now).map((o) => ({ ...o }));
  }
  async listForUser(userId: string) {
    return this.orders.filter((o) => o.userId === userId && o.status !== 'PENDING_PAYMENT');
  }
  async adminList(f: AdminOrderFilter) {
    const rows = this.orders.filter((o) => (!f.status || o.status === f.status) && (!f.provider || o.paymentProvider === f.provider));
    return { rows, total: rows.length };
  }
  async notes(orderId: string) {
    return this.notesList.filter((n) => n.orderId === orderId);
  }
  async addNote(orderId: string, body: string, author: string | null) {
    this.notesList.push({ orderId, id: createId(), body, author, createdAt: this.clock.now() });
  }
  async claimGuestOrders() {}
}
export class InMemoryCartRepository implements CartRepository {
  carts: CartRecord[] = [];
  lines_: CartLineRecord[] = [];
  promos = new Map<string, PromoRule>();

  async create(d: { token: string; userId?: string | null; utm?: Utm }) {
    const c: CartRecord = {
      id: createId(),
      token: d.token,
      userId: d.userId ?? null,
      promoCode: null,
      utmSource: d.utm?.source ?? null,
      utmMedium: d.utm?.medium ?? null,
      utmCampaign: d.utm?.campaign ?? null,
      mergedIntoId: null,
    };
    this.carts.push(c);
    return { ...c };
  }
  async findByToken(t: string) {
    const c = this.carts.find((x) => x.token === t);
    return c ? { ...c } : null;
  }
  async findByUserId(u: string) {
    const c = this.carts.find((x) => x.userId === u && !x.mergedIntoId);
    return c ? { ...c } : null;
  }
  async findById(id: string) {
    const c = this.carts.find((x) => x.id === id);
    return c ? { ...c } : null;
  }
  async update(id: string, patch: Partial<CartRecord>) {
    Object.assign(this.carts.find((x) => x.id === id) as CartRecord, patch);
  }
  async lines(cartId: string) {
    return this.lines_.filter((l) => l.cartId === cartId).map((l) => ({ ...l }));
  }
  async insertLine(cartId: string, variantId: string, quantity: number) {
    const existing = this.lines_.find((l) => l.cartId === cartId && l.variantId === variantId);
    if (existing) {
      existing.quantity = quantity;
      return { ...existing };
    }
    const l = { id: createId(), cartId, variantId, quantity, createdAt: new Date() };
    this.lines_.push(l);
    return { ...l };
  }
  async updateLine(id: string, patch: { variantId?: string; quantity?: number }) {
    Object.assign(this.lines_.find((l) => l.id === id) as CartLineRecord, patch);
  }
  async deleteLine(id: string) {
    this.lines_ = this.lines_.filter((l) => l.id !== id);
  }
  async clearLines(cartId: string) {
    this.lines_ = this.lines_.filter((l) => l.cartId !== cartId);
  }
  async findPromo(code: string) {
    return this.promos.get(code.toUpperCase()) ?? null;
  }
}

export class InMemoryExchangesRepository implements ExchangesRepository {
  exchanges: ExchangeRow[] = [];
  items: { exchangeId: string; orderItemId: string; quantity: number; valueKobo: number }[] = [];
  history: ExchangeHistoryRow[] = [];
  private seq = 2031;

  constructor(
    private readonly orders: InMemoryOrdersRepository,
    private readonly w: Warehouse,
    private readonly clock: Clock,
  ) {}

  async create(input: NewExchange) {
    const ex: ExchangeRow = {
      id: createId(),
      number: formatExchangeNumber(this.seq++),
      orderId: input.orderId,
      userId: input.userId,
      email: input.email,
      status: 'REQUESTED',
      reason: input.reason,
      note: input.note,
      photoUrls: input.photoUrls,
      creditKobo: 0,
      createdAt: this.clock.now(),
      updatedAt: this.clock.now(),
    };
    this.exchanges.push(ex);
    this.items.push(...input.items.map((i) => ({ ...i, exchangeId: ex.id })));
    this.history.push({ id: createId(), exchangeId: ex.id, status: 'REQUESTED', note: input.note, at: this.clock.now() });
    return ex.id;
  }
  async load(id: string) {
    return (await this.loadMany([id]))[0] ?? null;
  }
  async loadMany(ids: string[]): Promise<ExchangeAggregate[]> {
    const orderItems = this.orders.itemRows;
    return ids
      .map((id) => this.exchanges.find((e) => e.id === id))
      .filter((e): e is ExchangeRow => !!e)
      .map((e) => ({
        exchange: { ...e },
        orderNumber: this.orders.orders.find((o) => o.id === e.orderId)?.number ?? '',
        items: this.items
          .filter((i) => i.exchangeId === e.id)
          .map((i) => {
            const oi = orderItems.find((x: OrderItemRow) => x.id === i.orderItemId) as OrderItemRow;
            return { orderItemId: i.orderItemId, name: oi.name, quantity: i.quantity, valueKobo: i.valueKobo, variantId: oi.variantId };
          }),
        history: this.history.filter((h) => h.exchangeId === e.id),
      }));
  }
  async idsForCustomer(userId: string, email: string) {
    return this.exchanges.filter((e) => e.userId === userId || e.email === email).map((e) => e.id);
  }
  async idsForAdmin(status?: ExchangeStatus) {
    return this.exchanges.filter((e) => !status || e.status === status).map((e) => e.id);
  }
  async statusesForOrder(orderId: string) {
    return this.exchanges.filter((e) => e.orderId === orderId).map((e) => e.status);
  }
  async requestedQuantities(orderId: string) {
    const m = new Map<string, number>();
    for (const e of this.exchanges.filter((x) => x.orderId === orderId && ACTIVE_EXCHANGE_STATUSES.includes(x.status))) {
      for (const i of this.items.filter((x) => x.exchangeId === e.id)) m.set(i.orderItemId, (m.get(i.orderItemId) ?? 0) + i.quantity);
    }
    return m;
  }
  async transition(id: string, from: ExchangeStatus, to: ExchangeStatus, note: string | null) {
    const e = this.exchanges.find((x) => x.id === id);
    if (!e || e.status !== from) return false;
    e.status = to;
    this.history.push({ id: createId(), exchangeId: id, status: to, note, at: this.clock.now() });
    return true;
  }
  async setCredit(id: string, creditKobo: number) {
    (this.exchanges.find((x) => x.id === id) as ExchangeRow).creditKobo = creditKobo;
  }
  async restock(id: string) {
    for (const i of this.items.filter((x) => x.exchangeId === id)) {
      const oi = this.orders.itemRows.find((x) => x.id === i.orderItemId) as OrderItemRow;
      if (oi.variantId) this.w.stock.set(oi.variantId, (this.w.stock.get(oi.variantId) ?? 0) + i.quantity);
    }
  }
}

export class InMemoryWebhookEvents implements WebhookEventsRepository {
  rows: { id: string; provider: string; eventId: string; processed: boolean; error: string | null }[] = [];
  async record(provider: string, eventId: string): Promise<RecordedEvent> {
    const found = this.rows.find((r) => r.provider === provider && r.eventId === eventId);
    if (found) return { id: found.id, alreadyProcessed: found.processed };
    const row = { id: createId(), provider, eventId, processed: false, error: null };
    this.rows.push(row);
    return { id: row.id, alreadyProcessed: false };
  }
  async markProcessed(id: string) {
    (this.rows.find((r) => r.id === id) as { processed: boolean }).processed = true;
  }
  async markFailed(id: string, error: string) {
    (this.rows.find((r) => r.id === id) as { error: string | null }).error = error;
  }
}

export function zone(code: ZoneCode, feeKobo: number, active = true): DeliveryZoneRow {
  return { id: code, code, name: code, etaText: '1–2 working days', feeKobo, active, sortOrder: 0, updatedAt: new Date() };
}
