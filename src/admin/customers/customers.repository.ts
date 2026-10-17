import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/database.module';
import type { AddressSnapshot } from '../../db/schema';
import { PAID_STATUSES_SQL } from '../paid-orders';
import type { EmailOrderStats, RegisteredCustomer } from './customer-aggregation';

export const CUSTOMERS_REPOSITORY = Symbol('CUSTOMERS_REPOSITORY');

export interface CustomerOrder {
  id: string;
  number: string;
  createdAt: Date;
  paidAt: Date | null;
  status: string;
  provider: string | null;
  totalKobo: number;
  itemCount: number;
}

export interface CustomerAddress extends AddressSnapshot {
  id: string;
}

export interface LedgerEntryRow {
  id: string;
  email: string;
  amountKobo: number;
  reason: string;
  orderId: string | null;
  exchangeId: string | null;
  createdAt: Date;
  expiresAt: Date | null;
}

export interface CustomersRepository {
  /** Registered, non-deleted CUSTOMER accounts. `email` given → just that account (case-insensitive). */
  registered(email?: string): Promise<RegisteredCustomer[]>;
  /** Paid-order totals grouped by LOWER(email). `email` given → just that email. */
  paidOrderStats(email?: string): Promise<EmailOrderStats[]>;
  /** Credit ledger entries for these (lowercased) emails, oldest first. */
  ledgerFor(emails: string[]): Promise<LedgerEntryRow[]>;
  /** Every order (any status) placed with this email, newest first. */
  ordersFor(email: string): Promise<CustomerOrder[]>;
  addressesFor(userId: string): Promise<CustomerAddress[]>;
}

type Ts = Date | string;
const toDate = (v: Ts) => new Date(v);
const toDateOrNull = (v: Ts | null) => (v ? new Date(v) : null);

@Injectable()
export class DrizzleCustomersRepository implements CustomersRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async registered(email?: string): Promise<RegisteredCustomer[]> {
    const res = await this.db.execute<{
      id: string; email: string; first_name: string; last_name: string; phone: string | null; email_verified_at: Ts | null; created_at: Ts;
    }>(sql`
      SELECT id, email, first_name, last_name, phone, email_verified_at, created_at FROM users
      WHERE role = 'CUSTOMER' AND deleted_at IS NULL ${email ? sql`AND LOWER(email) = ${email.toLowerCase()}` : sql``}`);
    return res.rows.map((r) => ({
      userId: r.id,
      email: r.email,
      firstName: r.first_name,
      lastName: r.last_name,
      phone: r.phone,
      verified: !!r.email_verified_at,
      joinedAt: toDate(r.created_at),
    }));
  }

  async paidOrderStats(email?: string): Promise<EmailOrderStats[]> {
    const res = await this.db.execute<{
      email: string; orders: number; spent: string | number; last_at: Ts | null; last_name: string | null; last_phone: string | null;
    }>(sql`
      SELECT LOWER(email) AS email, COUNT(*)::int AS orders, SUM(total_kobo)::bigint AS spent,
        MAX(COALESCE(paid_at, created_at)) AS last_at,
        (ARRAY_AGG(NULLIF(address->>'fullName', '') ORDER BY COALESCE(paid_at, created_at) DESC) FILTER (WHERE NULLIF(address->>'fullName', '') IS NOT NULL))[1] AS last_name,
        (ARRAY_AGG(phone ORDER BY COALESCE(paid_at, created_at) DESC))[1] AS last_phone
      FROM orders
      WHERE status IN ${PAID_STATUSES_SQL} ${email ? sql`AND LOWER(email) = ${email.toLowerCase()}` : sql``}
      GROUP BY LOWER(email)`);
    return res.rows.map((r) => ({
      email: r.email,
      orders: Number(r.orders),
      totalSpentKobo: Number(r.spent ?? 0),
      lastOrderAt: toDateOrNull(r.last_at),
      lastName: r.last_name,
      lastPhone: r.last_phone,
    }));
  }

  async ledgerFor(emails: string[]): Promise<LedgerEntryRow[]> {
    if (!emails.length) return [];
    const list = sql.join(
      emails.map((e) => sql`${e.toLowerCase()}`),
      sql`, `,
    );
    const res = await this.db.execute<{
      id: string; email: string; amount_kobo: number; reason: string; order_id: string | null; exchange_id: string | null; created_at: Ts; expires_at: Ts | null;
    }>(sql`
      SELECT id, email, amount_kobo, reason, order_id, exchange_id, created_at, expires_at FROM credit_ledger
      WHERE email IN (${list}) ORDER BY created_at ASC`);
    return res.rows.map((r) => ({
      id: r.id,
      email: r.email,
      amountKobo: Number(r.amount_kobo),
      reason: r.reason,
      orderId: r.order_id,
      exchangeId: r.exchange_id,
      createdAt: toDate(r.created_at),
      expiresAt: toDateOrNull(r.expires_at),
    }));
  }

  async ordersFor(email: string): Promise<CustomerOrder[]> {
    const res = await this.db.execute<{
      id: string; number: string; created_at: Ts; paid_at: Ts | null; status: string; provider: string | null; total_kobo: number; item_count: number;
    }>(sql`
      SELECT o.id, o.number, o.created_at, o.paid_at, o.status::text AS status, o.payment_provider::text AS provider, o.total_kobo,
        COALESCE((SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.order_id = o.id), 0)::int AS item_count
      FROM orders o WHERE LOWER(o.email) = ${email.toLowerCase()} ORDER BY o.created_at DESC LIMIT 500`);
    return res.rows.map((r) => ({
      id: r.id,
      number: r.number,
      createdAt: toDate(r.created_at),
      paidAt: toDateOrNull(r.paid_at),
      status: r.status,
      provider: r.provider,
      totalKobo: Number(r.total_kobo),
      itemCount: Number(r.item_count),
    }));
  }

  async addressesFor(userId: string): Promise<CustomerAddress[]> {
    const res = await this.db.execute<{
      id: string; full_name: string; phone: string; state: string; lga: string; area: string; street: string; landmark: string; note: string | null;
    }>(sql`SELECT id, full_name, phone, state, lga, area, street, landmark, note FROM addresses WHERE user_id = ${userId} ORDER BY created_at ASC`);
    return res.rows.map((r) => ({
      id: r.id,
      fullName: r.full_name,
      phone: r.phone,
      state: r.state,
      lga: r.lga,
      area: r.area,
      street: r.street,
      landmark: r.landmark,
      note: r.note,
    }));
  }
}
