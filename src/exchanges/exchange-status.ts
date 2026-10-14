import type { ExchangeStatus } from '../common/contract';

/** EXC-7 state machine. `receive` moves APPROVED → ITEM_RECEIVED → CREDIT_ISSUED in one admin action. */
export const EXCHANGE_TRANSITIONS: Record<ExchangeStatus, ExchangeStatus[]> = {
  REQUESTED: ['APPROVED', 'DECLINED'],
  APPROVED: ['ITEM_RECEIVED', 'DECLINED'],
  ITEM_RECEIVED: ['CREDIT_ISSUED'],
  CREDIT_ISSUED: ['COMPLETED'],
  COMPLETED: [],
  DECLINED: [],
};

export function canTransitionExchange(from: ExchangeStatus, to: ExchangeStatus): boolean {
  return EXCHANGE_TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Cannot move from ${from} to ${to}`);
  }
}

export function assertExchangeTransition(from: ExchangeStatus, to: ExchangeStatus): void {
  if (!canTransitionExchange(from, to)) throw new InvalidTransitionError(from, to);
}

/** Exchanges that still "hold" order item quantity (anything not declined). */
export const ACTIVE_EXCHANGE_STATUSES: ExchangeStatus[] = ['REQUESTED', 'APPROVED', 'ITEM_RECEIVED', 'CREDIT_ISSUED', 'COMPLETED'];

/** EXC-1: within settings.exchangeWindowDays of deliveredAt. */
export function exchangeableUntil(deliveredAt: Date | null, windowDays: number): Date | null {
  if (!deliveredAt) return null;
  return new Date(deliveredAt.getTime() + windowDays * 86_400_000);
}

export function isWithinExchangeWindow(deliveredAt: Date | null, windowDays: number, now: Date): boolean {
  const until = exchangeableUntil(deliveredAt, windowDays);
  return until !== null && now.getTime() <= until.getTime();
}
