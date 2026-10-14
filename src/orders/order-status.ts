import type { OrderStatus } from '../common/contract';

/**
 * Order lifecycle (ACC-2). PENDING_PAYMENT → PAID only via verified payment, never by admin PATCH.
 * EXCHANGE_REQUESTED / EXCHANGED are driven by the exchanges module.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING_PAYMENT: ['PAID', 'CANCELLED'],
  PAID: ['PROCESSING', 'READY_FOR_PICKUP', 'DISPATCHED', 'DELIVERED', 'CANCELLED'],
  PROCESSING: ['READY_FOR_PICKUP', 'DISPATCHED', 'DELIVERED', 'CANCELLED'],
  READY_FOR_PICKUP: ['DELIVERED', 'CANCELLED'],
  DISPATCHED: ['DELIVERED'],
  DELIVERED: ['EXCHANGE_REQUESTED'],
  EXCHANGE_REQUESTED: ['DELIVERED', 'EXCHANGED'],
  EXCHANGED: ['EXCHANGE_REQUESTED'],
  CANCELLED: ['PAID'],
};

/** Statuses an admin may set by hand through PATCH /admin/orders/:id. */
export const ADMIN_SETTABLE: OrderStatus[] = ['PROCESSING', 'READY_FOR_PICKUP', 'DISPATCHED', 'DELIVERED', 'CANCELLED'];

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return from === to || ORDER_TRANSITIONS[from].includes(to);
}

export function canAdminSetStatus(from: OrderStatus, to: OrderStatus): boolean {
  return ADMIN_SETTABLE.includes(to) && from !== to && ORDER_TRANSITIONS[from].includes(to);
}

/** Customer emails sent on these admin status changes. */
export const NOTIFY_ON: OrderStatus[] = ['DISPATCHED', 'READY_FOR_PICKUP', 'DELIVERED'];

export const FULFILMENT_QUEUE: OrderStatus[] = ['PAID', 'PROCESSING', 'READY_FOR_PICKUP'];
export const PAID_STATUSES: OrderStatus[] = ['PAID', 'PROCESSING', 'READY_FOR_PICKUP', 'DISPATCHED', 'DELIVERED', 'EXCHANGE_REQUESTED', 'EXCHANGED'];
