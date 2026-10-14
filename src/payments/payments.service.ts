import { BadRequestException, Inject, Injectable, InternalServerErrorException, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { CLOCK, Clock } from '../common/clock';
import type { Order, ProviderCode } from '../common/contract';
import type { OrderRow } from '../db/schema';
import { ORDERS_REPOSITORY, OrdersRepository } from '../orders/orders.repository';
import { OrderLifecycleService } from '../orders/order-lifecycle.service';
import { OrdersService } from '../orders/orders.service';
import { ParsedWebhookEvent, WebhookHeaders, WebhookSignatureError } from './payment-provider';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { WEBHOOK_EVENTS_REPOSITORY, WebhookEventsRepository } from './webhook-events.repository';

/**
 * PAY-3: an order becomes PAID only here, and only after the provider's API confirms success and the amount.
 * Browser redirects (GET /checkout/verify) and webhooks both funnel into confirm().
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('PaymentsService');

  constructor(
    private readonly registry: PaymentProviderRegistry,
    @Inject(ORDERS_REPOSITORY) private readonly orders: OrdersRepository,
    @Inject(WEBHOOK_EVENTS_REPOSITORY) private readonly events: WebhookEventsRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly lifecycle: OrderLifecycleService,
    private readonly ordersView: OrdersService,
  ) {}

  /** Re-verifies with the provider and marks the order paid when (and only when) the provider confirms. */
  async confirm(order: OrderRow): Promise<'PAID' | 'PENDING' | 'FAILED' | 'EXPIRED' | 'ALREADY_PAID'> {
    if (order.status !== 'PENDING_PAYMENT' && order.status !== 'CANCELLED') return 'ALREADY_PAID';
    if (order.status === 'CANCELLED' && order.paymentStatus === 'SUCCEEDED') return 'ALREADY_PAID';
    const code = order.paymentProvider;
    if (!code || code === 'CREDIT' || !order.paymentReference) return 'PENDING';
    const provider = this.registry.get(code);
    const result = await provider.verify({
      reference: order.paymentReference,
      providerSessionId: order.providerSessionId,
      expectedAmountKobo: order.amountDueKobo,
    });
    if (result.status === 'SUCCEEDED') {
      if (!result.amountMatches) {
        this.logger.error(`Amount mismatch on ${order.number}: expected ${order.amountDueKobo}, provider reported ${result.amountKobo}`);
        await this.orders.addNote(order.id, `Payment amount mismatch: provider reported ${result.amountKobo} kobo, expected ${order.amountDueKobo}. Not marked paid.`, 'system');
        return 'FAILED';
      }
      await this.lifecycle.markPaid(order);
      return 'PAID';
    }
    if (result.status === 'FAILED') await this.lifecycle.recordPaymentFailure(order, 'FAILED');
    if (result.status === 'EXPIRED') await this.lifecycle.cancelUnpaid(order, 'EXPIRED');
    return result.status;
  }

  /** GET /checkout/verify — used by the return URL page. The webhook remains the source of truth. */
  async verifyByReference(reference: string): Promise<{ order: Order }> {
    const order = await this.orders.findByReference(reference);
    if (!order) throw new NotFoundException('Payment reference not found');
    try {
      await this.confirm(order);
    } catch (err) {
      this.logger.warn(`Verify for ${reference} failed: ${(err as Error).message}`);
    }
    const fresh = (await this.orders.findById(order.id)) as OrderRow;
    return { order: await this.ordersView.present(fresh) };
  }

  /** PAY-5: signed, idempotent webhook handling (400 bad signature; 5xx so the provider retries on failure). */
  async handleWebhook(code: ProviderCode, rawBody: Buffer | undefined, headers: WebhookHeaders): Promise<{ ok: true; duplicate?: boolean }> {
    if (!rawBody || rawBody.length === 0) throw new BadRequestException('Empty body');
    const provider = this.registry.get(code);
    if (!provider.isConfigured()) throw new ServiceUnavailableException(`${provider.displayName} is not configured`);
    let event: ParsedWebhookEvent;
    try {
      event = provider.parseWebhook(rawBody, headers);
    } catch (err) {
      if (err instanceof WebhookSignatureError) throw new BadRequestException(err.message);
      throw err;
    }
    const recorded = await this.events.record(code, event.eventId, event.type, event.payload);
    if (recorded.alreadyProcessed) return { ok: true, duplicate: true };
    try {
      await this.process(event);
      await this.events.markProcessed(recorded.id);
      return { ok: true };
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      this.logger.error(`Webhook ${code} ${event.eventId} failed: ${message}`);
      await this.events.markFailed(recorded.id, message);
      throw new InternalServerErrorException('Webhook processing failed');
    }
  }

  private async process(event: ParsedWebhookEvent): Promise<void> {
    if (event.outcome === 'IGNORED') return;
    const order =
      (event.reference ? await this.orders.findByReference(event.reference) : null) ??
      (event.sessionId ? await this.orders.findBySessionId(event.sessionId) : null);
    if (!order) {
      this.logger.warn(`Webhook ${event.type} for unknown order (ref=${event.reference}, session=${event.sessionId})`);
      return;
    }
    switch (event.outcome) {
      case 'PAID':
        await this.confirm(order);
        return;
      case 'FAILED':
        if (order.status === 'PENDING_PAYMENT') await this.lifecycle.recordPaymentFailure(order, 'FAILED');
        return;
      case 'EXPIRED':
        // Events can arrive out of order: double-check with the provider before cancelling.
        if ((await this.confirm(order)) === 'PENDING') await this.lifecycle.cancelUnpaid(order, 'EXPIRED');
        return;
    }
  }

  /** PAY-4: release stock holds of unpaid orders whose 15-minute hold has expired. */
  async expireStaleOrders(limit = 50): Promise<number> {
    const stale = await this.orders.findExpiredPending(this.clock.now(), limit);
    let cancelled = 0;
    for (const order of stale) {
      try {
        const outcome = order.paymentProvider && order.paymentProvider !== 'CREDIT' ? await this.confirm(order) : 'PENDING';
        if (outcome === 'PAID' || outcome === 'ALREADY_PAID') continue;
        if (await this.lifecycle.cancelUnpaid(order, 'EXPIRED')) cancelled++;
      } catch (err) {
        // Provider unreachable: still release the hold; a late successful payment revives the order.
        this.logger.warn(`Expiry check for ${order.number} failed (${(err as Error).message}); releasing hold`);
        if (await this.lifecycle.cancelUnpaid(order, 'EXPIRED')) cancelled++;
      }
    }
    return cancelled;
  }
}
