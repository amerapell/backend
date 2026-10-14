export interface LedgerEntry {
  amountKobo: number;
  createdAt: Date;
  expiresAt: Date | null;
}

interface Lot {
  remaining: number;
  expiresAt: Date | null;
}

const live = (lot: Lot, at: Date) => lot.remaining > 0 && (lot.expiresAt === null || lot.expiresAt.getTime() > at.getTime());

/**
 * EXC-6: credit balance with optional expiry. Credits form lots; each spend consumes the lots that were
 * live at the time of the spend, soonest-expiring first. Balance = remaining lots still live now.
 */
export function computeCreditBalance(entries: LedgerEntry[], now: Date): number {
  const sorted = [...entries].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || b.amountKobo - a.amountKobo);
  const lots: Lot[] = [];
  for (const e of sorted) {
    if (e.amountKobo > 0) {
      lots.push({ remaining: e.amountKobo, expiresAt: e.expiresAt });
      continue;
    }
    let toSpend = -e.amountKobo;
    const usable = lots
      .filter((l) => live(l, e.createdAt))
      .sort((a, b) => (a.expiresAt?.getTime() ?? Infinity) - (b.expiresAt?.getTime() ?? Infinity));
    for (const lot of usable) {
      if (toSpend <= 0) break;
      const take = Math.min(lot.remaining, toSpend);
      lot.remaining -= take;
      toSpend -= take;
    }
  }
  return lots.filter((l) => live(l, now)).reduce((n, l) => n + l.remaining, 0);
}
