import type { ZoneCode } from '../common/contract';

export interface QuoteInput {
  subtotalKobo: number;
  discountKobo: number;
  freeDeliveryPromo: boolean;
  zone: { code: ZoneCode; feeKobo: number };
  freeDeliveryThresholdKobo: number | null;
  creditAvailableKobo: number;
  useCredit: boolean;
}

export interface QuoteTotals {
  subtotalKobo: number;
  discountKobo: number;
  deliveryKobo: number;
  creditAvailableKobo: number;
  creditAppliedKobo: number;
  totalKobo: number;
  amountDueKobo: number;
}

/**
 * CHK-4 / EXC-5 / CRT-6: subtotal − discount + delivery = total; credit is applied against the total
 * (never more than the total), the rest is amount due. Pickup is always free; free-delivery promo or
 * reaching the threshold (on the discounted subtotal) zeroes the fee.
 */
export function computeQuote(input: QuoteInput): QuoteTotals {
  const subtotal = Math.max(0, input.subtotalKobo);
  const discount = Math.min(subtotal, Math.max(0, input.discountKobo));
  const merchandise = subtotal - discount;
  const thresholdMet = input.freeDeliveryThresholdKobo !== null && merchandise >= input.freeDeliveryThresholdKobo;
  const delivery =
    input.zone.code === 'PICKUP' || input.freeDeliveryPromo || thresholdMet ? 0 : Math.max(0, input.zone.feeKobo);
  const total = merchandise + delivery;
  const creditAvailable = Math.max(0, input.creditAvailableKobo);
  const creditApplied = input.useCredit ? Math.min(creditAvailable, total) : 0;
  return {
    subtotalKobo: subtotal,
    discountKobo: discount,
    deliveryKobo: delivery,
    creditAvailableKobo: creditAvailable,
    creditAppliedKobo: creditApplied,
    totalKobo: total,
    amountDueKobo: total - creditApplied,
  };
}
