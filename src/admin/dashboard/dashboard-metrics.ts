import { addDays, startOfLagosDay } from '../../common/clock';

/**
 * Pure date-bucketing for the admin dashboard (ADM-5). All "days" are Lagos calendar days (WAT, UTC+1, no DST).
 * Kept free of Nest/DB so it can be unit-tested with plain arrays.
 */

/** One paid order, reduced to what the dashboard needs. `at` = paidAt, falling back to createdAt. */
export interface PaidOrderFact {
  at: Date;
  totalKobo: number;
  email: string;
  provider: string | null;
}

export interface PeriodStats {
  salesKobo: number;
  orders: number;
  avgOrderKobo: number;
  /** Distinct customer emails (case-insensitive) with a paid order in the period. */
  paidCustomers: number;
}

export type PeriodKey = 'today' | 'last7' | 'last30';
export type PeriodSummary = PeriodStats & { previous: PeriodStats };

export interface TimeWindow {
  from: Date;
  to: Date;
}

const PERIOD_DAYS: Record<PeriodKey, number> = { today: 1, last7: 7, last30: 30 };
const LAGOS_OFFSET_MS = 60 * 60_000;

/** 'YYYY-MM-DD' of the Lagos calendar day that contains `d`. */
export function lagosDateKey(d: Date): string {
  return new Date(d.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Each period starts at Lagos midnight `days - 1` days ago and runs to `now` (so "today" = since midnight,
 * "7 days" = today + the 6 days before). The previous period is the same window shifted back by its length,
 * so today-so-far compares with yesterday up to the same time of day — like for like.
 */
export function periodWindows(now: Date): Record<PeriodKey, { current: TimeWindow; previous: TimeWindow }> {
  const sod = startOfLagosDay(now);
  const out = {} as Record<PeriodKey, { current: TimeWindow; previous: TimeWindow }>;
  for (const key of Object.keys(PERIOD_DAYS) as PeriodKey[]) {
    const days = PERIOD_DAYS[key];
    const from = addDays(sod, -(days - 1));
    out[key] = { current: { from, to: now }, previous: { from: addDays(from, -days), to: addDays(now, -days) } };
  }
  return out;
}

/** Earliest instant any dashboard metric looks at (start of the previous 30-day window). */
export function earliestNeeded(now: Date): Date {
  return periodWindows(now).last30.previous.from;
}

const inWindow = (f: PaidOrderFact, w: TimeWindow) => f.at.getTime() >= w.from.getTime() && f.at.getTime() <= w.to.getTime();

export function summarize(facts: PaidOrderFact[], w: TimeWindow): PeriodStats {
  let salesKobo = 0;
  let orders = 0;
  const emails = new Set<string>();
  for (const f of facts) {
    if (!inWindow(f, w)) continue;
    salesKobo += f.totalKobo;
    orders += 1;
    emails.add(f.email.trim().toLowerCase());
  }
  return { salesKobo, orders, avgOrderKobo: orders ? Math.round(salesKobo / orders) : 0, paidCustomers: emails.size };
}

export function summarizePeriods(facts: PaidOrderFact[], now: Date): Record<PeriodKey, PeriodSummary> {
  const windows = periodWindows(now);
  const out = {} as Record<PeriodKey, PeriodSummary>;
  for (const key of Object.keys(windows) as PeriodKey[]) {
    out[key] = { ...summarize(facts, windows[key].current), previous: summarize(facts, windows[key].previous) };
  }
  return out;
}

/** One entry per Lagos day for the last `days` days (oldest first, today last), zero-filled. */
export function salesByDay(facts: PaidOrderFact[], now: Date, days = 30): { date: string; salesKobo: number; orders: number }[] {
  const sod = startOfLagosDay(now);
  const buckets = new Map<string, { date: string; salesKobo: number; orders: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const date = lagosDateKey(addDays(sod, -i));
    buckets.set(date, { date, salesKobo: 0, orders: 0 });
  }
  for (const f of facts) {
    if (f.at.getTime() > now.getTime()) continue;
    const b = buckets.get(lagosDateKey(f.at));
    if (!b) continue;
    b.salesKobo += f.totalKobo;
    b.orders += 1;
  }
  return [...buckets.values()];
}

export function salesByProvider(facts: PaidOrderFact[], w: TimeWindow): { provider: string; orders: number; salesKobo: number }[] {
  const map = new Map<string, { provider: string; orders: number; salesKobo: number }>();
  for (const f of facts) {
    if (!inWindow(f, w)) continue;
    const provider = f.provider ?? 'NONE';
    const row = map.get(provider) ?? { provider, orders: 0, salesKobo: 0 };
    row.orders += 1;
    row.salesKobo += f.totalKobo;
    map.set(provider, row);
  }
  return [...map.values()].sort((a, b) => b.salesKobo - a.salesKobo || b.orders - a.orders);
}
