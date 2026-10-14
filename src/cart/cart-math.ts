import type { CartLine, DiscountType } from '../common/contract';
import { percentOf } from '../common/money';

export interface PromoRule {
  code: string;
  type: DiscountType;
  value: number;
  startsAt: Date | null;
  endsAt: Date | null;
  maxUses: number | null;
  usedCount: number;
  minSubtotalKobo: number | null;
  active: boolean;
}

export type PromoEvaluation =
  | { valid: true; discountKobo: number; freeDelivery: boolean }
  | { valid: false; reason: string };

/** CRT-5: percentage, fixed amount (kobo) and free delivery codes. */
export function evaluatePromo(rule: PromoRule | null, subtotalKobo: number, now: Date): PromoEvaluation {
  if (!rule || !rule.active) return { valid: false, reason: 'This promo code is not valid' };
  if (rule.startsAt && now < rule.startsAt) return { valid: false, reason: 'This promo code is not active yet' };
  if (rule.endsAt && now > rule.endsAt) return { valid: false, reason: 'This promo code has expired' };
  if (rule.maxUses !== null && rule.usedCount >= rule.maxUses) return { valid: false, reason: 'This promo code has been fully used' };
  if (rule.minSubtotalKobo !== null && subtotalKobo < rule.minSubtotalKobo) {
    return { valid: false, reason: 'Your bag does not meet the minimum spend for this code' };
  }
  switch (rule.type) {
    case 'PERCENT': {
      const pct = Math.min(100, Math.max(0, rule.value));
      return { valid: true, discountKobo: Math.min(subtotalKobo, percentOf(subtotalKobo, pct)), freeDelivery: false };
    }
    case 'FIXED':
      return { valid: true, discountKobo: Math.min(subtotalKobo, Math.max(0, rule.value)), freeDelivery: false };
    case 'FREE_DELIVERY':
      return { valid: true, discountKobo: 0, freeDelivery: true };
  }
}

/** CRT-4: a line is SOLD_OUT if nothing is available, LOW_STOCK if the bag asks for more than is available. */
export function lineProblem(quantity: number, available: number): CartLine['problem'] {
  if (available <= 0) return 'SOLD_OUT';
  if (quantity > available) return 'LOW_STOCK';
  return null;
}

export function cartTotals(lines: Pick<CartLine, 'unitKobo' | 'quantity'>[]): { subtotalKobo: number; itemCount: number } {
  return lines.reduce(
    (acc, l) => ({ subtotalKobo: acc.subtotalKobo + l.unitKobo * l.quantity, itemCount: acc.itemCount + l.quantity }),
    { subtotalKobo: 0, itemCount: 0 },
  );
}

export const MAX_LINE_QUANTITY = 10;
