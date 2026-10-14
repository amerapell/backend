import { allocateProportionally, decimalStringToKobo, formatNaira, koboToDecimalString, nairaToKobo, percentOf } from '../src/common/money';
import { isValidNigerianPhone, normalizeNigerianPhone } from '../src/common/phone';
import { canonicalState, lgasFor, STATE_NAMES } from '../src/common/nigeria/states';

describe('money (integer kobo)', () => {
  it('kobo → decimal string at NGN precision (for Bachs)', () => {
    expect(koboToDecimalString(18_500_000)).toBe('185000.00');
    expect(koboToDecimalString(6_250_050)).toBe('62500.50');
    expect(koboToDecimalString(5)).toBe('0.05');
    expect(koboToDecimalString(0)).toBe('0.00');
  });
  it('decimal string → kobo', () => {
    expect(decimalStringToKobo('185000.00')).toBe(18_500_000);
    expect(decimalStringToKobo('185000')).toBe(18_500_000);
    expect(decimalStringToKobo('62500.5')).toBe(6_250_050);
    expect(decimalStringToKobo('0.05')).toBe(5);
    expect(decimalStringToKobo(29)).toBe(2900);
  });
  it('round-trips', () => {
    for (const k of [0, 1, 99, 100, 12345, 18_500_000, 999_999_999]) expect(decimalStringToKobo(koboToDecimalString(k))).toBe(k);
  });
  it('rejects malformed decimals and invalid kobo', () => {
    expect(() => decimalStringToKobo('1.234')).toThrow();
    expect(() => decimalStringToKobo('-1.00')).toThrow();
    expect(() => decimalStringToKobo('abc')).toThrow();
    expect(() => koboToDecimalString(1.5)).toThrow();
    expect(() => koboToDecimalString(-1)).toThrow();
  });
  it('formats naira without kobo, as in the UI', () => {
    expect(formatNaira(18_500_000)).toBe('₦185,000');
    expect(formatNaira(24_750_000)).toBe('₦247,500');
    expect(formatNaira(0)).toBe('₦0');
    expect(nairaToKobo(62500)).toBe(6_250_000);
    expect(percentOf(10_001, 10)).toBe(1000);
  });
  it('allocates a discount proportionally and exactly', () => {
    const shares = allocateProportionally([18_500_000, 6_250_000], 2_475_000);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(2_475_000);
    expect(shares[0]).toBe(1_850_000);
    expect(shares[1]).toBe(625_000);
    const odd = allocateProportionally([1, 1, 1], 2);
    expect(odd.reduce((a, b) => a + b, 0)).toBe(2);
    expect(allocateProportionally([100, 200], 0)).toEqual([0, 0]);
    expect(allocateProportionally([100, 200], 1000)).toEqual([100, 200]);
  });
});

describe('Nigerian phone normalisation → E.164 +234', () => {
  it.each([
    ['08031234567', '+2348031234567'],
    ['0803 123 4567', '+2348031234567'],
    ['+2348031234567', '+2348031234567'],
    ['2348031234567', '+2348031234567'],
    ['+234 (0) 803-123-4567', '+2348031234567'],
    ['002348031234567', '+2348031234567'],
    ['8031234567', '+2348031234567'],
    ['07012345678', '+2347012345678'],
    ['09012345678', '+2349012345678'],
    ['08112345678', '+2348112345678'],
  ])('%s → %s', (input, out) => {
    expect(normalizeNigerianPhone(input)).toBe(out);
  });
  it.each(['', '123', '0803123456', '080312345678', '+447700900123', '06012345678', 'abc', '+234-803-12x-4567'])('rejects %p', (input) => {
    expect(normalizeNigerianPhone(input)).toBeNull();
    expect(isValidNigerianPhone(input)).toBe(false);
  });
});

describe('Nigerian states', () => {
  it('has 36 states + FCT, with all 20 Lagos LGAs', () => {
    expect(STATE_NAMES).toHaveLength(37);
    expect(lgasFor('Lagos')).toHaveLength(20);
    expect(lgasFor('lagos state')).toContain('Eti-Osa');
  });
  it('canonicalises aliases', () => {
    expect(canonicalState('abuja')).toBe('FCT');
    expect(canonicalState('Federal Capital Territory')).toBe('FCT');
    expect(canonicalState('akwa-ibom')).toBe('Akwa Ibom');
    expect(canonicalState('Atlantis')).toBeNull();
  });
});
