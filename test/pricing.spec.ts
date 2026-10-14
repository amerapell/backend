import { cartTotals, evaluatePromo, lineProblem, PromoRule } from '../src/cart/cart-math';
import { computeQuote } from '../src/checkout/pricing';

const now = new Date('2026-10-13T12:00:00Z');
const rule = (over: Partial<PromoRule>): PromoRule => ({
  code: 'X',
  type: 'PERCENT',
  value: 10,
  startsAt: null,
  endsAt: null,
  maxUses: null,
  usedCount: 0,
  minSubtotalKobo: null,
  active: true,
  ...over,
});

describe('cart totals and line problems (CRT-2, CRT-4)', () => {
  it('sums lines', () => {
    expect(cartTotals([{ unitKobo: 18_500_000, quantity: 1 }, { unitKobo: 6_250_000, quantity: 2 }])).toEqual({ subtotalKobo: 31_000_000, itemCount: 3 });
    expect(cartTotals([])).toEqual({ subtotalKobo: 0, itemCount: 0 });
  });
  it('flags sold-out and over-quantity lines', () => {
    expect(lineProblem(1, 0)).toBe('SOLD_OUT');
    expect(lineProblem(3, 2)).toBe('LOW_STOCK');
    expect(lineProblem(2, 2)).toBeNull();
  });
});

describe('promo codes (CRT-5)', () => {
  it('percentage, rounded down to whole kobo', () => {
    expect(evaluatePromo(rule({ value: 10 }), 24_750_001, now)).toEqual({ valid: true, discountKobo: 2_475_000, freeDelivery: false });
  });
  it('fixed amount never exceeds subtotal', () => {
    expect(evaluatePromo(rule({ type: 'FIXED', value: 1_000_000 }), 24_750_000, now)).toMatchObject({ discountKobo: 1_000_000 });
    expect(evaluatePromo(rule({ type: 'FIXED', value: 99_000_000 }), 24_750_000, now)).toMatchObject({ discountKobo: 24_750_000 });
  });
  it('free delivery', () => {
    expect(evaluatePromo(rule({ type: 'FREE_DELIVERY', value: 0 }), 100, now)).toEqual({ valid: true, discountKobo: 0, freeDelivery: true });
  });
  it('rejects unknown, inactive, not started, expired, used up, below minimum', () => {
    expect(evaluatePromo(null, 1, now).valid).toBe(false);
    expect(evaluatePromo(rule({ active: false }), 1, now).valid).toBe(false);
    expect(evaluatePromo(rule({ startsAt: new Date('2026-10-14') }), 1, now).valid).toBe(false);
    expect(evaluatePromo(rule({ endsAt: new Date('2026-10-12') }), 1, now).valid).toBe(false);
    expect(evaluatePromo(rule({ maxUses: 5, usedCount: 5 }), 1, now).valid).toBe(false);
    expect(evaluatePromo(rule({ minSubtotalKobo: 5_000_000 }), 4_999_999, now)).toEqual({
      valid: false,
      reason: 'Your bag does not meet the minimum spend for this code',
    });
  });
});

describe('checkout quote (CHK-4, CRT-6, EXC-5)', () => {
  const base = {
    subtotalKobo: 24_750_000,
    discountKobo: 0,
    freeDeliveryPromo: false,
    zone: { code: 'LEKKI_AJAH' as const, feeKobo: 450_000 },
    freeDeliveryThresholdKobo: null,
    creditAvailableKobo: 0,
    useCredit: true,
  };

  it('subtotal − discount + delivery = total; amount due = total − credit', () => {
    expect(computeQuote({ ...base, discountKobo: 2_475_000, creditAvailableKobo: 6_250_000 })).toEqual({
      subtotalKobo: 24_750_000,
      discountKobo: 2_475_000,
      deliveryKobo: 450_000,
      creditAvailableKobo: 6_250_000,
      creditAppliedKobo: 6_250_000,
      totalKobo: 22_725_000,
      amountDueKobo: 16_475_000,
    });
  });
  it('credit is optional (toggle off)', () => {
    const q = computeQuote({ ...base, creditAvailableKobo: 6_250_000, useCredit: false });
    expect(q.creditAppliedKobo).toBe(0);
    expect(q.amountDueKobo).toBe(q.totalKobo);
  });
  it('credit covering everything → amount due 0, remainder stays as credit', () => {
    const q = computeQuote({ ...base, creditAvailableKobo: 30_000_000 });
    expect(q.creditAppliedKobo).toBe(25_200_000);
    expect(q.amountDueKobo).toBe(0);
    expect(q.creditAvailableKobo - q.creditAppliedKobo).toBe(4_800_000);
  });
  it('pickup is free', () => {
    expect(computeQuote({ ...base, zone: { code: 'PICKUP', feeKobo: 999 } }).deliveryKobo).toBe(0);
  });
  it('free-delivery threshold is measured after discount', () => {
    expect(computeQuote({ ...base, freeDeliveryThresholdKobo: 24_750_000 }).deliveryKobo).toBe(0);
    expect(computeQuote({ ...base, discountKobo: 1, freeDeliveryThresholdKobo: 24_750_000 }).deliveryKobo).toBe(450_000);
  });
  it('free-delivery promo zeroes the fee', () => {
    expect(computeQuote({ ...base, freeDeliveryPromo: true }).deliveryKobo).toBe(0);
  });
  it('never goes negative', () => {
    const q = computeQuote({ ...base, subtotalKobo: 100, discountKobo: 500 });
    expect(q.discountKobo).toBe(100);
    expect(q.totalKobo).toBe(450_000);
  });
});
