import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/database.module';
import { HELD_BY_VARIANT } from '../../catalogue/catalogue.repository';

export const DASHBOARD_REPOSITORY = Symbol('DASHBOARD_REPOSITORY');

export interface DashboardData {
  todaySalesKobo: number;
  ordersToFulfil: number;
  pendingExchanges: number;
  bestSellers: { name: string; units: number }[];
  lowStock: { sku: string; name: string; available: number }[];
  ordersBySource: { source: string; count: number }[];
}

export interface DashboardRepository {
  load(startOfToday: Date, since: Date): Promise<DashboardData>;
}

const PAID = sql`('PAID','PROCESSING','READY_FOR_PICKUP','DISPATCHED','DELIVERED','EXCHANGE_REQUESTED','EXCHANGED')`;

@Injectable()
export class DrizzleDashboardRepository implements DashboardRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async load(startOfToday: Date, since: Date): Promise<DashboardData> {
    const today = startOfToday.toISOString();
    const from = since.toISOString();
    const [sales, fulfil, exch, best, low, sources] = await Promise.all([
      this.db.execute<{ v: number }>(sql`SELECT COALESCE(SUM(total_kobo), 0)::bigint AS v FROM orders WHERE paid_at >= ${today}::timestamptz AND status IN ${PAID}`),
      this.db.execute<{ v: number }>(sql`SELECT COUNT(*)::int AS v FROM orders WHERE status IN ('PAID','PROCESSING','READY_FOR_PICKUP')`),
      this.db.execute<{ v: number }>(sql`SELECT COUNT(*)::int AS v FROM exchanges WHERE status IN ('REQUESTED','APPROVED')`),
      this.db.execute<{ name: string; units: number }>(sql`
        SELECT oi.name, SUM(oi.quantity)::int AS units FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.paid_at >= ${from}::timestamptz AND o.status IN ${PAID}
        GROUP BY oi.name ORDER BY units DESC LIMIT 5`),
      this.db.execute<{ sku: string; name: string; available: number }>(sql`
        SELECT v.sku, p.name || COALESCE(' · ' || v.colour, '') || COALESCE(' · ' || v.size, '') AS name,
          (v.stock - COALESCE(h.held, 0))::int AS available
        FROM variants v JOIN products p ON p.id = v.product_id
        LEFT JOIN ${HELD_BY_VARIANT} h ON h.variant_id = v.id
        WHERE v.archived = false AND p.status = 'LIVE' AND (v.stock - COALESCE(h.held, 0)) <= p.low_stock_threshold
        ORDER BY available ASC, p.name LIMIT 20`),
      this.db.execute<{ source: string; count: number }>(sql`
        SELECT COALESCE(NULLIF(LOWER(utm_source), ''), 'direct') AS source, COUNT(*)::int AS count
        FROM orders WHERE paid_at >= ${from}::timestamptz AND status IN ${PAID}
        GROUP BY 1 ORDER BY count DESC`),
    ]);
    return {
      todaySalesKobo: Number(sales.rows[0]?.v ?? 0),
      ordersToFulfil: Number(fulfil.rows[0]?.v ?? 0),
      pendingExchanges: Number(exch.rows[0]?.v ?? 0),
      bestSellers: best.rows.map((r) => ({ name: r.name, units: Number(r.units) })),
      lowStock: low.rows.map((r) => ({ sku: r.sku, name: r.name, available: Math.max(0, Number(r.available)) })),
      ordersBySource: sources.rows.map((r) => ({ source: r.source, count: Number(r.count) })),
    };
  }
}
