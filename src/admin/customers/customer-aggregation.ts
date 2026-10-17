/**
 * Pure customer aggregation for the admin Customers page. A "customer" is a lowercased email: either a registered
 * CUSTOMER account, a guest email with at least one paid order, or both (merged).
 */

export interface RegisteredCustomer {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  verified: boolean;
  joinedAt: Date;
}

/** Paid-order totals for one email (the repository groups by LOWER(email); merge is defensive anyway). */
export interface EmailOrderStats {
  email: string;
  orders: number;
  totalSpentKobo: number;
  lastOrderAt: Date | null;
  /** Name / phone from the customer's most recent paid order (used for guests). */
  lastName: string | null;
  lastPhone: string | null;
}

export interface CustomerSummary {
  email: string;
  userId: string | null;
  name: string;
  phone: string | null;
  registered: boolean;
  verified: boolean;
  joinedAt: Date | null;
  orders: number;
  totalSpentKobo: number;
  lastOrderAt: Date | null;
}

export type CustomerSort = 'recent' | 'spent' | 'orders';
export const CUSTOMER_SORTS: CustomerSort[] = ['recent', 'spent', 'orders'];

export const normaliseEmail = (e: string) => e.trim().toLowerCase();

const later = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a.getTime() >= b.getTime() ? a : b);

export function mergeCustomers(registered: RegisteredCustomer[], stats: EmailOrderStats[]): CustomerSummary[] {
  const byEmail = new Map<string, EmailOrderStats>();
  for (const s of stats) {
    const email = normaliseEmail(s.email);
    const prev = byEmail.get(email);
    if (!prev) {
      byEmail.set(email, { ...s, email });
      continue;
    }
    const newer = s.lastOrderAt && (!prev.lastOrderAt || s.lastOrderAt.getTime() > prev.lastOrderAt.getTime()) ? s : prev;
    byEmail.set(email, {
      email,
      orders: prev.orders + s.orders,
      totalSpentKobo: prev.totalSpentKobo + s.totalSpentKobo,
      lastOrderAt: later(prev.lastOrderAt, s.lastOrderAt),
      lastName: newer.lastName ?? prev.lastName ?? s.lastName,
      lastPhone: newer.lastPhone ?? prev.lastPhone ?? s.lastPhone,
    });
  }

  const out = new Map<string, CustomerSummary>();
  for (const u of registered) {
    const email = normaliseEmail(u.email);
    const s = byEmail.get(email);
    const name = `${u.firstName} ${u.lastName}`.trim() || s?.lastName || email;
    out.set(email, {
      email,
      userId: u.userId,
      name,
      phone: u.phone ?? s?.lastPhone ?? null,
      registered: true,
      verified: u.verified,
      joinedAt: u.joinedAt,
      orders: s?.orders ?? 0,
      totalSpentKobo: s?.totalSpentKobo ?? 0,
      lastOrderAt: s?.lastOrderAt ?? null,
    });
  }
  for (const s of byEmail.values()) {
    if (out.has(s.email) || s.orders < 1) continue;
    out.set(s.email, {
      email: s.email,
      userId: null,
      name: s.lastName?.trim() || s.email,
      phone: s.lastPhone,
      registered: false,
      verified: false,
      joinedAt: null,
      orders: s.orders,
      totalSpentKobo: s.totalSpentKobo,
      lastOrderAt: s.lastOrderAt,
    });
  }
  return [...out.values()];
}

const time = (d: Date | null) => (d ? d.getTime() : -Infinity);

const COMPARATORS: Record<CustomerSort, (a: CustomerSummary, b: CustomerSummary) => number> = {
  recent: (a, b) => time(b.lastOrderAt) - time(a.lastOrderAt) || time(b.joinedAt) - time(a.joinedAt),
  spent: (a, b) => b.totalSpentKobo - a.totalSpentKobo || b.orders - a.orders,
  orders: (a, b) => b.orders - a.orders || b.totalSpentKobo - a.totalSpentKobo,
};

export function queryCustomers(
  rows: CustomerSummary[],
  opts: { q?: string; sort: CustomerSort; page: number; pageSize: number },
): { items: CustomerSummary[]; total: number } {
  const term = opts.q?.trim().toLowerCase();
  const digits = term?.replace(/\D/g, '') ?? '';
  const filtered = term
    ? rows.filter(
        (r) =>
          r.email.includes(term) ||
          r.name.toLowerCase().includes(term) ||
          (!!r.phone && (r.phone.toLowerCase().includes(term) || (digits.length >= 4 && r.phone.replace(/\D/g, '').includes(digits.replace(/^0/, ''))))),
      )
    : rows;
  const sorted = [...filtered].sort((a, b) => COMPARATORS[opts.sort](a, b) || a.email.localeCompare(b.email));
  const start = (opts.page - 1) * opts.pageSize;
  return { items: sorted.slice(start, start + opts.pageSize), total: filtered.length };
}
