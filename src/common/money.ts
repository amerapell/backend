/**
 * Money helpers. All money is stored and transported as integer kobo (₦1 = 100 kobo).
 */
export type Kobo = number;

export function assertKobo(value: number, label = 'amount'): Kobo {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer number of kobo`);
  }
  return value;
}

/** 18500000 kobo -> "185000.00" (decimal string at NGN precision, for Bachs). */
export function koboToDecimalString(kobo: Kobo): string {
  assertKobo(kobo);
  const naira = Math.floor(kobo / 100);
  const rest = kobo % 100;
  return `${naira}.${rest.toString().padStart(2, '0')}`;
}

/** "185000.00" | "185000" | "185000.5" -> 18500050 kobo. Rejects >2 decimal places or malformed input. */
export function decimalStringToKobo(value: string | number): Kobo {
  const s = typeof value === 'number' ? value.toFixed(2) : String(value).trim();
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`Invalid decimal amount: ${value}`);
  const naira = Number(m[1]);
  const frac = (m[2] ?? '').padEnd(2, '0');
  return naira * 100 + Number(frac);
}

export function nairaToKobo(naira: number): Kobo {
  return Math.round(naira * 100);
}

/** 18500000 -> "₦185,000" (no kobo shown, as in the UI). */
export function formatNaira(kobo: Kobo): string {
  const naira = Math.round(kobo / 100);
  return '₦' + naira.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Percentage of an amount, rounded down to whole kobo. */
export function percentOf(kobo: Kobo, percent: number): Kobo {
  return Math.floor((kobo * percent) / 100);
}

/**
 * Allocates an order-level discount across lines proportionally to line value (largest-remainder),
 * so that the allocations always sum exactly to the discount. Returns per-line discount in kobo.
 */
export function allocateProportionally(lineTotals: Kobo[], amount: Kobo): Kobo[] {
  const total = lineTotals.reduce((a, b) => a + b, 0);
  if (total <= 0 || amount <= 0) return lineTotals.map(() => 0);
  const capped = Math.min(amount, total);
  const raw = lineTotals.map((t) => (t * capped) / total);
  const floors = raw.map((r) => Math.floor(r));
  let remainder = capped - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] += 1;
    remainder -= 1;
  }
  return floors;
}
