import { computeCreditBalance } from '../src/credit/credit-ledger';

const d = (s: string) => new Date(s);

describe('exchange credit balance (EXC-5, EXC-6)', () => {
  it('sums credits minus spends without expiry', () => {
    expect(
      computeCreditBalance(
        [
          { amountKobo: 6_250_000, createdAt: d('2026-10-01'), expiresAt: null },
          { amountKobo: -2_000_000, createdAt: d('2026-10-02'), expiresAt: null },
          { amountKobo: 1_000_000, createdAt: d('2026-10-03'), expiresAt: null },
        ],
        d('2026-10-13'),
      ),
    ).toBe(5_250_000);
  });
  it('a cancelled order gives the spend back', () => {
    expect(
      computeCreditBalance(
        [
          { amountKobo: 5_000_000, createdAt: d('2026-10-01'), expiresAt: null },
          { amountKobo: -5_000_000, createdAt: d('2026-10-02'), expiresAt: null },
          { amountKobo: 5_000_000, createdAt: d('2026-10-02T00:20:00Z'), expiresAt: null },
        ],
        d('2026-10-13'),
      ),
    ).toBe(5_000_000);
  });
  it('expired credit no longer counts', () => {
    expect(computeCreditBalance([{ amountKobo: 5_000_000, createdAt: d('2026-01-01'), expiresAt: d('2026-06-01') }], d('2026-10-13'))).toBe(0);
  });
  it('spends consume the soonest-expiring lot first', () => {
    const entries = [
      { amountKobo: 3_000_000, createdAt: d('2026-10-01'), expiresAt: null },
      { amountKobo: 2_000_000, createdAt: d('2026-10-02'), expiresAt: d('2026-10-10') },
      { amountKobo: -2_000_000, createdAt: d('2026-10-05'), expiresAt: null },
    ];
    // The expiring lot was used up, so nothing is lost when it expires.
    expect(computeCreditBalance(entries, d('2026-10-13'))).toBe(3_000_000);
  });
  it('a spend cannot use credit that had already expired at the time', () => {
    const entries = [
      { amountKobo: 2_000_000, createdAt: d('2026-01-01'), expiresAt: d('2026-02-01') },
      { amountKobo: 3_000_000, createdAt: d('2026-03-01'), expiresAt: null },
      { amountKobo: -1_000_000, createdAt: d('2026-04-01'), expiresAt: null },
    ];
    expect(computeCreditBalance(entries, d('2026-10-13'))).toBe(2_000_000);
  });
  it('is zero for no entries', () => {
    expect(computeCreditBalance([], d('2026-10-13'))).toBe(0);
  });
});
