import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNull, lt, or, sql, SQL } from 'drizzle-orm';
import { DRIZZLE, Database } from '../db/database.module';
import { creditLedger, discounts, orderItems, orderNotes, orders, stockHolds, variants } from '../db/schema';
import type { AddressSnapshot, OrderItemRow, OrderRow } from '../db/schema';
import type { OrderStatus, PaymentProviderName, PaymentStatus, ZoneCode } from '../common/contract';
import { formatOrderNumber } from '../common/ids';
import { computeCreditBalance } from '../credit/credit-ledger';
import { lockCreditAccount } from '../credit/credit.repository';
import { CREDIT_REASONS } from '../credit/credit.service';
import { escapeLike } from '../catalogue/catalogue.repository';

export const ORDERS_REPOSITORY = Symbol('ORDERS_REPOSITORY');

export class InsufficientStockError extends Error {
  constructor(public readonly variantIds: string[]) {
    super('Some items are no longer available in the quantity requested');
  }
}

export class CreditUnavailableError extends Error {
  constructor() {
    super('Your exchange credit balance has changed — please review your order');
  }
}

export interface NewOrderItem {
  productId: string;
  variantId: string;
  sku: string;
  name: string;
  number: string;
  colour: string | null;
  size: string | null;
  material: string | null;
  imageUrl: string | null;
  unitKobo: number;
  paidUnitKobo: number;
  quantity: number;
  exchangeable: boolean;
}

export interface CreateOrderInput {
  userId: string | null;
  cartId: string | null;
  email: string;
  /** Ledger account the credit is spent from (the signed-in customer's email). */
  creditEmail: string;
  phone: string;
  zoneCode: ZoneCode;
  zoneName: string;
  address: AddressSnapshot | null;
  subtotalKobo: number;
  discountKobo: number;
  discountCode: string | null;
  deliveryKobo: number;
  creditAppliedKobo: number;
  totalKobo: number;
  amountDueKobo: number;
  paymentProvider: PaymentProviderName;
  utm: { source: string | null; medium: string | null; campaign: string | null };
  marketingConsent: boolean;
  holdExpiresAt: Date;
  now: Date;
  items: NewOrderItem[];
}

export interface OrderWithItems {
  order: OrderRow;
  items: OrderItemRow[];
}

export interface AdminOrderFilter {
  status?: OrderStatus;
  provider?: PaymentProviderName;
  q?: string;
  page: number;
  pageSize: number;
}

export interface OrdersRepository {
  createWithHolds(input: CreateOrderInput): Promise<OrderWithItems>;
  findById(id: string): Promise<OrderRow | null>;
  findByNumber(number: string): Promise<OrderRow | null>;
  findByReference(reference: string): Promise<OrderRow | null>;
  findBySessionId(sessionId: string): Promise<OrderRow | null>;
  items(orderId: string): Promise<OrderItemRow[]>;
  itemsFor(orderIds: string[]): Promise<OrderItemRow[]>;
  setPayment(orderId: string, patch: { paymentReference?: string; providerSessionId?: string | null; paymentStatus?: PaymentStatus }): Promise<void>;
  /** Atomically: PENDING_PAYMENT|CANCELLED → PAID, consume holds into stock, count promo use. False if already paid. */
  markPaid(orderId: string, at: Date): Promise<{ changed: boolean; wasCancelled: boolean }>;
  /** Atomically: PENDING_PAYMENT → CANCELLED with holds released. False if the order was no longer pending. */
  cancelUnpaid(orderId: string, paymentStatus: PaymentStatus, at: Date): Promise<boolean>;
  updateStatus(orderId: string, status: OrderStatus, extra?: { deliveredAt?: Date; cancelledAt?: Date }): Promise<void>;
  restock(orderId: string): Promise<void>;
  findExpiredPending(now: Date, limit: number): Promise<OrderRow[]>;
  listForUser(userId: string): Promise<OrderRow[]>;
  adminList(filter: AdminOrderFilter): Promise<{ rows: OrderRow[]; total: number }>;
  notes(orderId: string): Promise<{ id: string; body: string; author: string | null; createdAt: Date }[]>;
  addNote(orderId: string, body: string, author: string | null): Promise<void>;
  claimGuestOrders(userId: string, email: string): Promise<void>;
}

@Injectable()
export class DrizzleOrdersRepository implements OrdersRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async createWithHolds(input: CreateOrderInput): Promise<OrderWithItems> {
    return this.db.transaction(async (tx) => {
      const variantIds = [...new Set(input.items.map((i) => i.variantId))].sort();
      // Lock variant rows in a stable order so concurrent checkouts serialise instead of deadlocking.
      const locked = await tx.execute<{ id: string; stock: number; held: number }>(sql`
        SELECT v.id, v.stock,
          COALESCE((SELECT SUM(h.quantity) FROM stock_holds h WHERE h.variant_id = v.id AND h.released_at IS NULL
            AND h.consumed_at IS NULL AND h.expires_at > ${input.now.toISOString()}::timestamptz), 0)::int AS held
        FROM variants v WHERE v.id IN (${sql.join(variantIds.map((id) => sql`${id}`), sql`, `)})
        ORDER BY v.id FOR UPDATE OF v`);
      const availability = new Map(locked.rows.map((r) => [r.id, Number(r.stock) - Number(r.held)]));
      const short = input.items.filter((i) => (availability.get(i.variantId) ?? 0) < i.quantity).map((i) => i.variantId);
      if (short.length) throw new InsufficientStockError(short);

      if (input.creditAppliedKobo > 0) {
        await lockCreditAccount(tx, input.creditEmail);
        const entries = await tx.select().from(creditLedger).where(eq(creditLedger.email, input.creditEmail));
        if (computeCreditBalance(entries, input.now) < input.creditAppliedKobo) throw new CreditUnavailableError();
      }

      const seq = await tx.execute<{ n: string }>(sql`SELECT nextval('order_number_seq') AS n`);
      const number = formatOrderNumber(Number(seq.rows[0].n));
      const [order] = await tx
        .insert(orders)
        .values({
          number,
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
          paymentStatus: 'PENDING',
          utmSource: input.utm.source,
          utmMedium: input.utm.medium,
          utmCampaign: input.utm.campaign,
          marketingConsent: input.marketingConsent,
          holdExpiresAt: input.holdExpiresAt,
        })
        .returning();
      const items = await tx
        .insert(orderItems)
        .values(input.items.map((i) => ({ ...i, orderId: order.id })))
        .returning();
      await tx.insert(stockHolds).values(
        input.items.map((i) => ({ variantId: i.variantId, orderId: order.id, quantity: i.quantity, expiresAt: input.holdExpiresAt })),
      );
      if (input.creditAppliedKobo > 0) {
        await tx.insert(creditLedger).values({
          email: input.creditEmail,
          userId: input.userId,
          amountKobo: -input.creditAppliedKobo,
          reason: CREDIT_REASONS.ORDER_SPEND,
          orderId: order.id,
        });
      }
      return { order, items };
    });
  }

  private async one(where: SQL | undefined): Promise<OrderRow | null> {
    const [row] = await this.db.select().from(orders).where(where).limit(1);
    return row ?? null;
  }

  findById(id: string) {
    return this.one(eq(orders.id, id));
  }
  findByNumber(number: string) {
    return this.one(eq(orders.number, number.trim().toUpperCase()));
  }
  findByReference(reference: string) {
    return this.one(eq(orders.paymentReference, reference));
  }
  findBySessionId(sessionId: string) {
    return this.one(eq(orders.providerSessionId, sessionId));
  }

  items(orderId: string): Promise<OrderItemRow[]> {
    return this.db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.id));
  }

  async itemsFor(orderIds: string[]): Promise<OrderItemRow[]> {
    if (!orderIds.length) return [];
    return this.db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds));
  }

  async setPayment(orderId: string, patch: { paymentReference?: string; providerSessionId?: string | null; paymentStatus?: PaymentStatus }): Promise<void> {
    await this.db.update(orders).set(patch).where(eq(orders.id, orderId));
  }

  async markPaid(orderId: string, at: Date): Promise<{ changed: boolean; wasCancelled: boolean }> {
    return this.db.transaction(async (tx) => {
      const locked = await tx.execute<{ status: OrderStatus; discount_code: string | null }>(
        sql`SELECT status, discount_code FROM orders WHERE id = ${orderId} FOR UPDATE`,
      );
      const row = locked.rows[0];
      if (!row || (row.status !== 'PENDING_PAYMENT' && row.status !== 'CANCELLED')) return { changed: false, wasCancelled: false };
      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
      for (const item of items) {
        if (!item.variantId) continue;
        await tx
          .update(variants)
          .set({ stock: sql`GREATEST(${variants.stock} - ${item.quantity}, 0)`, updatedAt: at })
          .where(eq(variants.id, item.variantId));
      }
      await tx.update(stockHolds).set({ consumedAt: at }).where(and(eq(stockHolds.orderId, orderId), isNull(stockHolds.consumedAt)));
      await tx.update(orders).set({ status: 'PAID', paidAt: at, paymentStatus: 'SUCCEEDED', cancelledAt: null }).where(eq(orders.id, orderId));
      if (row.discount_code) {
        await tx.update(discounts).set({ usedCount: sql`${discounts.usedCount} + 1` }).where(eq(discounts.code, row.discount_code));
      }
      return { changed: true, wasCancelled: row.status === 'CANCELLED' };
    });
  }

  async cancelUnpaid(orderId: string, paymentStatus: PaymentStatus, at: Date): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const locked = await tx.execute<{ status: OrderStatus }>(sql`SELECT status FROM orders WHERE id = ${orderId} FOR UPDATE`);
      if (locked.rows[0]?.status !== 'PENDING_PAYMENT') return false;
      await tx
        .update(stockHolds)
        .set({ releasedAt: at })
        .where(and(eq(stockHolds.orderId, orderId), isNull(stockHolds.releasedAt), isNull(stockHolds.consumedAt)));
      await tx.update(orders).set({ status: 'CANCELLED', paymentStatus, cancelledAt: at }).where(eq(orders.id, orderId));
      return true;
    });
  }

  async updateStatus(orderId: string, status: OrderStatus, extra: { deliveredAt?: Date; cancelledAt?: Date } = {}): Promise<void> {
    await this.db.update(orders).set({ status, ...extra }).where(eq(orders.id, orderId));
  }

  async restock(orderId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
      for (const item of items) {
        if (!item.variantId) continue;
        await tx.update(variants).set({ stock: sql`${variants.stock} + ${item.quantity}` }).where(eq(variants.id, item.variantId));
      }
    });
  }

  findExpiredPending(now: Date, limit: number): Promise<OrderRow[]> {
    return this.db
      .select()
      .from(orders)
      .where(and(eq(orders.status, 'PENDING_PAYMENT'), lt(orders.holdExpiresAt, now)))
      .orderBy(asc(orders.holdExpiresAt))
      .limit(limit);
  }

  listForUser(userId: string): Promise<OrderRow[]> {
    return this.db
      .select()
      .from(orders)
      .where(and(eq(orders.userId, userId), sql`${orders.status} <> 'PENDING_PAYMENT'`))
      .orderBy(desc(orders.createdAt));
  }

  async adminList(f: AdminOrderFilter): Promise<{ rows: OrderRow[]; total: number }> {
    const conds: SQL[] = [];
    if (f.status) conds.push(eq(orders.status, f.status));
    if (f.provider) conds.push(eq(orders.paymentProvider, f.provider));
    if (f.q) {
      const like = `%${escapeLike(f.q.trim())}%`;
      conds.push(or(ilike(orders.number, like), ilike(orders.email, like), ilike(orders.phone, like), ilike(orders.paymentReference, like)) as SQL);
    }
    const where = conds.length ? and(...conds) : undefined;
    const [rows, count] = await Promise.all([
      this.db
        .select()
        .from(orders)
        .where(where)
        .orderBy(desc(orders.createdAt))
        .limit(f.pageSize)
        .offset((f.page - 1) * f.pageSize),
      this.db.select({ n: sql<number>`COUNT(*)::int` }).from(orders).where(where),
    ]);
    return { rows, total: Number(count[0]?.n ?? 0) };
  }

  notes(orderId: string) {
    return this.db
      .select({ id: orderNotes.id, body: orderNotes.body, author: orderNotes.author, createdAt: orderNotes.createdAt })
      .from(orderNotes)
      .where(eq(orderNotes.orderId, orderId))
      .orderBy(asc(orderNotes.createdAt));
  }

  async addNote(orderId: string, body: string, author: string | null): Promise<void> {
    await this.db.insert(orderNotes).values({ orderId, body, author });
  }

  async claimGuestOrders(userId: string, email: string): Promise<void> {
    await this.db
      .update(orders)
      .set({ userId })
      .where(and(eq(orders.email, email.toLowerCase()), isNull(orders.userId)));
  }
}
