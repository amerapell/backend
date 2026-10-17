import { Inject, Injectable } from '@nestjs/common';
import { addDays, CLOCK, Clock } from '../common/clock';
import { SettingsService } from '../settings/settings.service';
import { computeCreditBalance } from './credit-ledger';
import { CREDIT_REPOSITORY, CreditRepository } from './credit.repository';

export interface CreditStatement {
  balanceKobo: number;
  entries: { id: string; amountKobo: number; reason: string; createdAt: string; expiresAt: string | null }[];
}

export const CREDIT_REASONS = {
  EXCHANGE: 'EXCHANGE_CREDIT',
  ORDER_SPEND: 'ORDER_PAYMENT',
  ORDER_REVERSAL: 'ORDER_CANCELLED_REFUND_TO_CREDIT',
  ORDER_REVIVED: 'ORDER_PAYMENT_REAPPLIED',
  ORDER_UNFULFILLED: 'ORDER_UNFULFILLED_CREDIT',
} as const;

/** EXC-4..6: exchange credit — issued on receipt, spent at checkout, never paid out as cash. */
@Injectable()
export class CreditService {
  constructor(
    @Inject(CREDIT_REPOSITORY) private readonly repo: CreditRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly settings: SettingsService,
  ) {}

  async balance(email: string): Promise<number> {
    return computeCreditBalance(await this.repo.entriesFor(email), this.clock.now());
  }

  async statement(email: string): Promise<CreditStatement> {
    const entries = await this.repo.entriesFor(email);
    return {
      balanceKobo: computeCreditBalance(entries, this.clock.now()),
      entries: entries
        .slice()
        .reverse()
        .map((e) => ({
          id: e.id,
          amountKobo: e.amountKobo,
          reason: e.reason,
          createdAt: e.createdAt.toISOString(),
          expiresAt: e.expiresAt ? e.expiresAt.toISOString() : null,
        })),
    };
  }

  async expiryForNewCredit(): Promise<Date | null> {
    const { creditExpiryDays } = await this.settings.get();
    return creditExpiryDays ? addDays(this.clock.now(), creditExpiryDays) : null;
  }

  async issueForExchange(email: string, userId: string | null, amountKobo: number, exchangeId: string, orderId: string): Promise<{ balanceKobo: number; expiresAt: Date | null }> {
    const expiresAt = await this.expiryForNewCredit();
    if (amountKobo > 0) {
      await this.repo.add({ email, userId, amountKobo, reason: CREDIT_REASONS.EXCHANGE, exchangeId, orderId, expiresAt });
    }
    return { balanceKobo: await this.balance(email), expiresAt };
  }

  /**
   * The store cancelled a paid order it can't fulfil: what the customer paid becomes exchange credit to choose
   * another piece (no cash refunds). Idempotent per order. Returns the credit added (0 if already done).
   */
  async issueForUnfulfilledOrder(email: string, userId: string | null, amountKobo: number, orderId: string): Promise<number> {
    if (amountKobo <= 0) return 0;
    const entries = await this.repo.entriesForOrder(orderId);
    if (entries.some((e) => e.reason === CREDIT_REASONS.ORDER_UNFULFILLED)) return 0;
    await this.repo.add({ email, userId, amountKobo, reason: CREDIT_REASONS.ORDER_UNFULFILLED, orderId, expiresAt: await this.expiryForNewCredit() });
    return amountKobo;
  }

  /** Puts credit spent on an order back when that order is cancelled/expires unpaid. Idempotent per order. */
  async reverseOrderSpend(orderId: string): Promise<void> {
    const entries = await this.repo.entriesForOrder(orderId);
    const net = entries.reduce((n, e) => n + e.amountKobo, 0);
    const spent = entries.filter((e) => e.reason === CREDIT_REASONS.ORDER_SPEND || e.reason === CREDIT_REASONS.ORDER_REVIVED);
    if (!spent.length || net >= 0) return;
    const first = spent[0];
    await this.repo.add({
      email: first.email,
      userId: first.userId,
      amountKobo: -net,
      reason: CREDIT_REASONS.ORDER_REVERSAL,
      orderId,
      expiresAt: await this.expiryForNewCredit(),
    });
  }

  /** A cancelled order paid late: take the credit portion again (it was given back on cancellation). */
  async reapplyOrderSpend(orderId: string, email: string, userId: string | null, creditAppliedKobo: number): Promise<void> {
    if (creditAppliedKobo <= 0) return;
    const entries = await this.repo.entriesForOrder(orderId);
    const net = entries.reduce((n, e) => n + e.amountKobo, 0);
    if (net <= -creditAppliedKobo) return;
    await this.repo.add({ email, userId, amountKobo: -(creditAppliedKobo + net), reason: CREDIT_REASONS.ORDER_REVIVED, orderId });
  }
}
