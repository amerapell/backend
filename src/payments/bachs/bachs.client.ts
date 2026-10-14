import { Logger } from '@nestjs/common';
import type { FetchFn } from '../payment-provider';
import { PaymentProviderError } from '../payment-provider';

export const BACHS_BASE_URLS = { sandbox: 'https://sandbox-api.bachs.io', live: 'https://api.bachs.io' } as const;

export type BachsObject = Record<string, unknown>;

/** Responses may or may not be wrapped in `{ data: … }`. */
export function unwrap(body: unknown): BachsObject {
  const obj = (body ?? {}) as BachsObject;
  const inner = obj.data as BachsObject | undefined;
  if (inner && typeof inner === 'object' && !Array.isArray(inner) && !('checkout_url' in obj) && !('id' in obj) && !('checkout_id' in obj)) {
    return inner;
  }
  return obj;
}

/** Hosted checkout URL — field name confirmed as `checkout_url` in the docs; `url`/`hosted_url` accepted defensively. */
export function extractCheckoutUrl(session: BachsObject): string | null {
  const v = session.url ?? session.checkout_url ?? session.hosted_url;
  return typeof v === 'string' && v ? v : null;
}

export function extractSessionId(session: BachsObject): string | null {
  const v = session.checkout_id ?? session.id;
  return typeof v === 'string' && v ? v : null;
}

/**
 * Thin Bachs REST client. The product/price payload and checkout-session shape are isolated here
 * (createOrderProduct, createCheckoutSession, extractCheckoutUrl) so they can be adjusted without touching the provider.
 */
export class BachsClient {
  private readonly logger = new Logger('BachsClient');

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly fetchFn: FetchFn,
  ) {}

  private async call(method: 'GET' | 'POST', path: string, body?: unknown, idempotencyKey?: string): Promise<BachsObject> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => null)) as BachsObject | null;
    if (!res.ok || !json) {
      const err = (json?.error as BachsObject | undefined)?.message ?? json?.message ?? `HTTP ${res.status}`;
      this.logger.warn(`Bachs ${method} ${path} failed: ${String(err)}`);
      throw new PaymentProviderError(`Bachs: ${String(err)}`, res.status);
    }
    return unwrap(json);
  }

  /** One-off product priced at the order's amount due (decimal string, NGN). */
  async createOrderProduct(orderNumber: string, amount: string, idempotencyKey: string): Promise<string> {
    const product = await this.call(
      'POST',
      '/v1/products',
      { name: `Amerapelle order ${orderNumber}`, price: { amount, currency: 'NGN' } },
      `${idempotencyKey}:product`,
    );
    const id = product.id ?? product.product_id;
    if (typeof id !== 'string') throw new PaymentProviderError('Bachs: product id missing in response');
    return id;
  }

  async createCheckoutSession(input: {
    productId?: string;
    pricing?: { amount: string; currency: string };
    email: string;
    successUrl: string;
    cancelUrl: string;
    reference: string;
    metadata: Record<string, string>;
  }): Promise<BachsObject> {
    const body: Record<string, unknown> = {
      customer: { email: input.email },
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      reference: input.reference,
      metadata: input.metadata,
    };
    if (input.productId) body.product_cart = [{ product_id: input.productId, quantity: 1 }];
    else body.pricing = input.pricing;
    return this.call('POST', '/v1/checkout-sessions', body, input.reference);
  }

  getCheckoutSession(id: string): Promise<BachsObject> {
    return this.call('GET', `/v1/checkout-sessions/${encodeURIComponent(id)}`);
  }
}
