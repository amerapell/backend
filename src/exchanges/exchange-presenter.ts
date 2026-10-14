import type { AdminExchange, AdminExchangeDetail, Exchange } from '../common/contract';
import type { OrderItemRow, OrderRow } from '../db/schema';
import type { ExchangeAggregate } from './exchanges.repository';
import { exchangeableUntil } from './exchange-status';

export function toExchange(agg: ExchangeAggregate): Exchange {
  const e = agg.exchange;
  return {
    id: e.id,
    number: e.number,
    orderNumber: agg.orderNumber,
    status: e.status,
    reason: e.reason,
    note: e.note,
    photoUrls: e.photoUrls ?? [],
    items: agg.items.map((i) => ({ orderItemId: i.orderItemId, name: i.name, quantity: i.quantity, valueKobo: i.valueKobo })),
    creditKobo: e.creditKobo,
    history: agg.history.map((h) => ({ status: h.status, at: h.at.toISOString(), note: h.note })),
    createdAt: e.createdAt.toISOString(),
  };
}

export function toAdminExchange(agg: ExchangeAggregate): AdminExchange {
  return { ...toExchange(agg), email: agg.exchange.email };
}

/** Admin detail: exchange + order/customer context + exchange window, all server-computed. */
export function toAdminExchangeDetail(agg: ExchangeAggregate, order: OrderRow, orderItems: OrderItemRow[], exchangeWindowDays: number): AdminExchangeDetail {
  const base = toAdminExchange(agg);
  const until = exchangeableUntil(order.deliveredAt, exchangeWindowDays);
  return {
    ...base,
    orderId: order.id,
    orderStatus: order.status,
    customer: {
      name: order.address?.fullName || agg.customerName || null,
      email: agg.exchange.email,
      phone: order.address?.phone || order.phone || null,
      userId: agg.exchange.userId,
    },
    items: agg.items.map((i) => {
      const oi = orderItems.find((x) => x.id === i.orderItemId);
      return {
        orderItemId: i.orderItemId,
        name: i.name,
        quantity: i.quantity,
        valueKobo: i.valueKobo,
        number: oi?.number ?? null,
        sku: oi?.sku ?? null,
        colour: oi?.colour ?? null,
        size: oi?.size ?? null,
        imageUrl: oi?.imageUrl ?? null,
        paidUnitKobo: oi?.paidUnitKobo ?? null,
      };
    }),
    deliveredAt: order.deliveredAt?.toISOString() ?? null,
    exchangeWindowDays,
    exchangeableUntil: until?.toISOString() ?? null,
    requestedWithinWindow: until !== null && agg.exchange.createdAt.getTime() <= until.getTime(),
    updatedAt: agg.exchange.updatedAt.toISOString(),
  };
}
