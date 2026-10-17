import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/database.module';
import { HELD_BY_VARIANT } from '../../catalogue/catalogue.repository';
import { PAID_STATUSES_SQL } from '../paid-orders';
import type { PaidOrderFact } from './dashboard-metrics';

export const DASHBOARD_REPOSITORY = Symbol('DASHBOARD_REPOSITORY');

export interface DashboardData {
  todaySalesKobo: number;
  ordersToFulfil: number;
  pendingExchanges: number;
  bestSellers: { name: string; units: number }[];
  lowStock: { sku: string; name: string; available: number }[];
  ordersBySource: { source: string; count: number }[];
}

export interface RecentOrder {
  id: string;
  number: string;
  createdAt: string;
  status: string;
  provider: string | null;
  totalKobo: number;
  customerName: string;
  email: string;
  itemCount: number;
}

export interface CustomerCounts {
  total: number;
  newLast7: number;
  verified: number;
  payingCustomers: number;
  repeatCustomers: number;
}

export interface DashboardRepository {
  /** The original ADM-5 tiles (today's sales, fulfilment queue, exchanges, best sellers, low stock, sources). */
  load(startOfToday: Date, since: Date): Promise<DashboardData>;
  /** Paid orders whose paidAt (or createdAt when paidAt is missing) falls in [from, to]. */
  paidOrderFacts(from: Date, to: Date): Promise<PaidOrderFact[]>;
  recentOrders(limit: number): Promise<RecentOrder[]>;
  /** `newSince` = start of the 7-day window. */
  customerCounts(newSince: Date): Promise<CustomerCounts>;
  latestOrderAt(): Promise<Date | null>;
}

const PAID = PAID_STATUSES_SQL;

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

  async paidOrderFacts(from: Date, to: Date): Promise<PaidOrderFact[]> {
    const res = await this.db.execute<{ at: Date | string; total_kobo: number; email: string; provider: string | null }>(sql`
      SELECT COALESCE(paid_at, created_at) AS at, total_kobo, email, payment_provider::text AS provider
      FROM orders
      WHERE status IN ${PAID} AND COALESCE(paid_at, created_at) BETWEEN ${from.toISOString()}::timestamptz AND ${to.toISOString()}::timestamptz`);
    return res.rows.map((r) => ({ at: new Date(r.at), totalKobo: Number(r.total_kobo), email: r.email, provider: r.provider }));
  }

  async recentOrders(limit: number): Promise<RecentOrder[]> {
    const res = await this.db.execute<{
      id: string; number: string; created_at: Date | string; status: string; provider: string | null; total_kobo: number;
      customer_name: string | null; email: string; item_count: number;
    }>(sql`
      SELECT o.id, o.number, o.created_at, o.status::text AS status, o.payment_provider::text AS provider, o.total_kobo, o.email,
        COALESCE(NULLIF(o.address->>'fullName', ''), NULLIF(TRIM(u.first_name || ' ' || u.last_name), '')) AS customer_name,
        COALESCE((SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.order_id = o.id), 0)::int AS item_count
      FROM orders o LEFT JOIN users u ON u.id = o.user_id
      ORDER BY o.created_at DESC LIMIT ${limit}`);
    return res.rows.map((r) => ({
      id: r.id,
      number: r.number,
      createdAt: new Date(r.created_at).toISOString(),
      status: r.status,
      provider: r.provider,
      totalKobo: Number(r.total_kobo),
      customerName: r.customer_name ?? r.email,
      email: r.email,
      itemCount: Number(r.item_count),
    }));
  }

  async customerCounts(newSince: Date): Promise<CustomerCounts> {
    const res = await this.db.execute<Record<keyof CustomerCounts, number>>(sql`
      WITH c AS (SELECT created_at, email_verified_at FROM users WHERE role = 'CUSTOMER' AND deleted_at IS NULL),
      p AS (SELECT LOWER(email) AS email, COUNT(*) AS n FROM orders WHERE status IN ${PAID} GROUP BY 1)
      SELECT
        (SELECT COUNT(*) FROM c)::int AS "total",
        (SELECT COUNT(*) FROM c WHERE created_at >= ${newSince.toISOString()}::timestamptz)::int AS "newLast7",
        (SELECT COUNT(*) FROM c WHERE email_verified_at IS NOT NULL)::int AS "verified",
        (SELECT COUNT(*) FROM p)::int AS "payingCustomers",
        (SELECT COUNT(*) FROM p WHERE n >= 2)::int AS "repeatCustomers"`);
    const r = res.rows[0];
    return {
      total: Number(r?.total ?? 0),
      newLast7: Number(r?.newLast7 ?? 0),
      verified: Number(r?.verified ?? 0),
      payingCustomers: Number(r?.payingCustomers ?? 0),
      repeatCustomers: Number(r?.repeatCustomers ?? 0),
    };
  }

  async latestOrderAt(): Promise<Date | null> {
    const res = await this.db.execute<{ v: Date | string | null }>(sql`SELECT MAX(created_at) AS v FROM orders`);
    const v = res.rows[0]?.v;
    return v ? new Date(v) : null;
  }
}
