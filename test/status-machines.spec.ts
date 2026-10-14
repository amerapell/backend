import { canTransitionExchange, assertExchangeTransition, exchangeableUntil, isWithinExchangeWindow, EXCHANGE_TRANSITIONS } from '../src/exchanges/exchange-status';
import { canAdminSetStatus, canTransitionOrder } from '../src/orders/order-status';
import { EXCHANGE_STATUSES } from '../src/common/contract';

describe('exchange status transitions (EXC-7)', () => {
  it('follows REQUESTED → APPROVED → ITEM_RECEIVED → CREDIT_ISSUED → COMPLETED', () => {
    expect(canTransitionExchange('REQUESTED', 'APPROVED')).toBe(true);
    expect(canTransitionExchange('APPROVED', 'ITEM_RECEIVED')).toBe(true);
    expect(canTransitionExchange('ITEM_RECEIVED', 'CREDIT_ISSUED')).toBe(true);
    expect(canTransitionExchange('CREDIT_ISSUED', 'COMPLETED')).toBe(true);
  });
  it('can decline before the item is received only', () => {
    expect(canTransitionExchange('REQUESTED', 'DECLINED')).toBe(true);
    expect(canTransitionExchange('APPROVED', 'DECLINED')).toBe(true);
    expect(canTransitionExchange('ITEM_RECEIVED', 'DECLINED')).toBe(false);
    expect(canTransitionExchange('CREDIT_ISSUED', 'DECLINED')).toBe(false);
  });
  it('cannot skip steps, go backwards, or leave terminal states', () => {
    expect(canTransitionExchange('REQUESTED', 'ITEM_RECEIVED')).toBe(false);
    expect(canTransitionExchange('REQUESTED', 'CREDIT_ISSUED')).toBe(false);
    expect(canTransitionExchange('APPROVED', 'REQUESTED')).toBe(false);
    for (const to of EXCHANGE_STATUSES) {
      expect(canTransitionExchange('COMPLETED', to)).toBe(false);
      expect(canTransitionExchange('DECLINED', to)).toBe(false);
    }
    expect(() => assertExchangeTransition('COMPLETED', 'APPROVED')).toThrow('Cannot move from COMPLETED to APPROVED');
  });
  it('covers every status', () => {
    expect(Object.keys(EXCHANGE_TRANSITIONS).sort()).toEqual([...EXCHANGE_STATUSES].sort());
  });
  it('exchange window counts from deliveredAt (EXC-1)', () => {
    const delivered = new Date('2026-10-01T10:00:00Z');
    expect(exchangeableUntil(delivered, 7)?.toISOString()).toBe('2026-10-08T10:00:00.000Z');
    expect(isWithinExchangeWindow(delivered, 7, new Date('2026-10-08T10:00:00Z'))).toBe(true);
    expect(isWithinExchangeWindow(delivered, 7, new Date('2026-10-08T10:00:01Z'))).toBe(false);
    expect(isWithinExchangeWindow(null, 7, new Date())).toBe(false);
  });
});

describe('order status transitions (ACC-2, ADM-3)', () => {
  it('admin can move a paid order through fulfilment', () => {
    expect(canAdminSetStatus('PAID', 'PROCESSING')).toBe(true);
    expect(canAdminSetStatus('PROCESSING', 'DISPATCHED')).toBe(true);
    expect(canAdminSetStatus('DISPATCHED', 'DELIVERED')).toBe(true);
    expect(canAdminSetStatus('PROCESSING', 'READY_FOR_PICKUP')).toBe(true);
    expect(canAdminSetStatus('READY_FOR_PICKUP', 'DELIVERED')).toBe(true);
  });
  it('admin can never mark an order PAID or exchange statuses by hand', () => {
    expect(canAdminSetStatus('PENDING_PAYMENT', 'PAID')).toBe(false);
    expect(canAdminSetStatus('DELIVERED', 'EXCHANGED')).toBe(false);
    expect(canAdminSetStatus('DELIVERED', 'EXCHANGE_REQUESTED')).toBe(false);
  });
  it('no going backwards after dispatch', () => {
    expect(canAdminSetStatus('DISPATCHED', 'PROCESSING')).toBe(false);
    expect(canAdminSetStatus('DISPATCHED', 'CANCELLED')).toBe(false);
    expect(canAdminSetStatus('DELIVERED', 'PAID')).toBe(false);
  });
  it('a cancelled (expired) order may still become PAID by a late verified payment', () => {
    expect(canTransitionOrder('CANCELLED', 'PAID')).toBe(true);
  });
});
