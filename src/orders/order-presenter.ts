import { isInternationalZone } from '../common/countries';
import type { Order } from '../common/contract';
import type { OrderItemRow, OrderRow } from '../db/schema';
import { exchangeableUntil } from '../exchanges/exchange-status';

/** DHL Express tracking page for orders abroad; local deliveries have no public tracking page. */
export function trackingUrl(zone: string, trackingNumber: string | null | undefined): string | null {
  if (!trackingNumber || !isInternationalZone(zone)) return null;
  return `https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=${encodeURIComponent(trackingNumber)}`;
}

export function toOrder(order: OrderRow, items: OrderItemRow[], exchangeWindowDays: number): Order {
  const until = exchangeableUntil(order.deliveredAt, exchangeWindowDays);
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    email: order.email,
    phone: order.phone,
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      number: i.number,
      colour: i.colour,
      size: i.size,
      unitKobo: i.unitKobo,
      quantity: i.quantity,
      imageUrl: i.imageUrl,
      exchangeable: i.exchangeable,
    })),
    delivery: {
      zone: order.zoneCode,
      name: order.zoneName,
      feeKobo: order.deliveryKobo,
      address: order.address ?? null,
      trackingNumber: order.trackingNumber ?? null,
      trackingUrl: trackingUrl(order.zoneCode, order.trackingNumber),
    },
    subtotalKobo: order.subtotalKobo,
    discountKobo: order.discountKobo,
    creditAppliedKobo: order.creditAppliedKobo,
    deliveryKobo: order.deliveryKobo,
    totalKobo: order.totalKobo,
    amountDueKobo: order.amountDueKobo,
    payment: order.paymentProvider
      ? { provider: order.paymentProvider, reference: order.paymentReference, status: order.paymentStatus ?? 'PENDING' }
      : null,
    createdAt: order.createdAt.toISOString(),
    paidAt: order.paidAt ? order.paidAt.toISOString() : null,
    deliveredAt: order.deliveredAt ? order.deliveredAt.toISOString() : null,
    exchangeableUntil: until ? until.toISOString() : null,
  };
}
