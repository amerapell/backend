import type { Exchange } from '../common/contract';
import type { ExchangeAggregate } from './exchanges.repository';

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
