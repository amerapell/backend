import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { DRIZZLE, Database } from '../db/database.module';
import { exchangeHistory, exchangeItems, exchanges, orderItems, orders, variants } from '../db/schema';
import type { ExchangeHistoryRow, ExchangeRow } from '../db/schema';
import type { ExchangeStatus } from '../common/contract';
import { formatExchangeNumber } from '../common/ids';
import { ACTIVE_EXCHANGE_STATUSES } from './exchange-status';

export const EXCHANGES_REPOSITORY = Symbol('EXCHANGES_REPOSITORY');

export interface ExchangeAggregate {
  exchange: ExchangeRow;
  orderNumber: string;
  items: { orderItemId: string; name: string; quantity: number; valueKobo: number; variantId: string | null }[];
  history: ExchangeHistoryRow[];
}

export interface NewExchange {
  orderId: string;
  userId: string | null;
  email: string;
  reason: string;
  note: string | null;
  photoUrls: string[];
  items: { orderItemId: string; quantity: number; valueKobo: number }[];
}

export interface ExchangesRepository {
  create(input: NewExchange): Promise<string>;
  load(id: string): Promise<ExchangeAggregate | null>;
  loadMany(ids: string[]): Promise<ExchangeAggregate[]>;
  idsForCustomer(userId: string, email: string): Promise<string[]>;
  idsForAdmin(status?: ExchangeStatus): Promise<string[]>;
  statusesForOrder(orderId: string): Promise<ExchangeStatus[]>;
  /** Quantity of each order item already in a non-declined exchange. */
  requestedQuantities(orderId: string): Promise<Map<string, number>>;
  transition(id: string, from: ExchangeStatus, to: ExchangeStatus, note: string | null): Promise<boolean>;
  setCredit(id: string, creditKobo: number): Promise<void>;
  restock(id: string): Promise<void>;
}

@Injectable()
export class DrizzleExchangesRepository implements ExchangesRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async create(input: NewExchange): Promise<string> {
    return this.db.transaction(async (tx) => {
      // Serialise requests per order so two tabs cannot exchange the same unit twice.
      await tx.execute(sql`SELECT id FROM orders WHERE id = ${input.orderId} FOR UPDATE`);
      const seq = await tx.execute<{ n: string }>(sql`SELECT nextval('exchange_number_seq') AS n`);
      const [ex] = await tx
        .insert(exchanges)
        .values({
          number: formatExchangeNumber(Number(seq.rows[0].n)),
          orderId: input.orderId,
          userId: input.userId,
          email: input.email,
          status: 'REQUESTED',
          reason: input.reason,
          note: input.note,
          photoUrls: input.photoUrls,
          creditKobo: 0,
        })
        .returning();
      await tx.insert(exchangeItems).values(input.items.map((i) => ({ ...i, exchangeId: ex.id })));
      await tx.insert(exchangeHistory).values({ exchangeId: ex.id, status: 'REQUESTED', note: input.note });
      return ex.id;
    });
  }

  async load(id: string): Promise<ExchangeAggregate | null> {
    const [agg] = await this.loadMany([id]);
    return agg ?? null;
  }

  async loadMany(ids: string[]): Promise<ExchangeAggregate[]> {
    if (!ids.length) return [];
    const [rows, items, history] = await Promise.all([
      this.db
        .select({ exchange: exchanges, orderNumber: orders.number })
        .from(exchanges)
        .innerJoin(orders, eq(orders.id, exchanges.orderId))
        .where(inArray(exchanges.id, ids)),
      this.db
        .select({
          exchangeId: exchangeItems.exchangeId,
          orderItemId: exchangeItems.orderItemId,
          quantity: exchangeItems.quantity,
          valueKobo: exchangeItems.valueKobo,
          name: orderItems.name,
          variantId: orderItems.variantId,
        })
        .from(exchangeItems)
        .innerJoin(orderItems, eq(orderItems.id, exchangeItems.orderItemId))
        .where(inArray(exchangeItems.exchangeId, ids)),
      this.db.select().from(exchangeHistory).where(inArray(exchangeHistory.exchangeId, ids)).orderBy(asc(exchangeHistory.at)),
    ]);
    const byId = new Map(rows.map((r) => [r.exchange.id, r]));
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map((r) => ({
        exchange: r.exchange,
        orderNumber: r.orderNumber,
        items: items
          .filter((i) => i.exchangeId === r.exchange.id)
          .map(({ orderItemId, name, quantity, valueKobo, variantId }) => ({ orderItemId, name, quantity, valueKobo, variantId })),
        history: history.filter((h) => h.exchangeId === r.exchange.id),
      }));
  }

  async idsForCustomer(userId: string, email: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: exchanges.id })
      .from(exchanges)
      .where(or(eq(exchanges.userId, userId), eq(exchanges.email, email.toLowerCase())))
      .orderBy(desc(exchanges.createdAt));
    return rows.map((r) => r.id);
  }

  async idsForAdmin(status?: ExchangeStatus): Promise<string[]> {
    const rows = await this.db
      .select({ id: exchanges.id })
      .from(exchanges)
      .where(status ? eq(exchanges.status, status) : undefined)
      .orderBy(desc(exchanges.createdAt))
      .limit(500);
    return rows.map((r) => r.id);
  }

  async statusesForOrder(orderId: string): Promise<ExchangeStatus[]> {
    const rows = await this.db.select({ status: exchanges.status }).from(exchanges).where(eq(exchanges.orderId, orderId));
    return rows.map((r) => r.status);
  }

  async requestedQuantities(orderId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ orderItemId: exchangeItems.orderItemId, qty: sql<number>`SUM(${exchangeItems.quantity})::int` })
      .from(exchangeItems)
      .innerJoin(exchanges, eq(exchanges.id, exchangeItems.exchangeId))
      .where(and(eq(exchanges.orderId, orderId), inArray(exchanges.status, ACTIVE_EXCHANGE_STATUSES)))
      .groupBy(exchangeItems.orderItemId);
    return new Map(rows.map((r) => [r.orderItemId, Number(r.qty)]));
  }

  /** Compare-and-set so two admins clicking at once cannot double-issue credit. */
  async transition(id: string, from: ExchangeStatus, to: ExchangeStatus, note: string | null): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const updated = await tx
        .update(exchanges)
        .set({ status: to })
        .where(and(eq(exchanges.id, id), eq(exchanges.status, from)))
        .returning({ id: exchanges.id });
      if (!updated.length) return false;
      await tx.insert(exchangeHistory).values({ exchangeId: id, status: to, note });
      return true;
    });
  }

  async setCredit(id: string, creditKobo: number): Promise<void> {
    await this.db.update(exchanges).set({ creditKobo }).where(eq(exchanges.id, id));
  }

  async restock(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .select({ variantId: orderItems.variantId, quantity: exchangeItems.quantity })
        .from(exchangeItems)
        .innerJoin(orderItems, eq(orderItems.id, exchangeItems.orderItemId))
        .where(eq(exchangeItems.exchangeId, id));
      for (const r of rows) {
        if (r.variantId) await tx.update(variants).set({ stock: sql`${variants.stock} + ${r.quantity}` }).where(eq(variants.id, r.variantId));
      }
    });
  }
}
