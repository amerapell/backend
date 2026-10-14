import type { ProviderCode } from '../common/contract';

export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS');
export const HTTP_FETCH = Symbol('HTTP_FETCH');
export type FetchFn = typeof fetch;

export interface InitializePaymentInput {
  orderId: string;
  orderNumber: string;
  email: string;
  amountKobo: number;
  reference: string;
  /** `${FRONTEND_URL}/checkout/complete?reference=…` */
  callbackUrl: string;
  cancelUrl: string;
}

export interface InitializePaymentResult {
  authorizationUrl: string;
  reference: string;
  providerSessionId: string | null;
}

export interface VerifyPaymentInput {
  reference: string;
  providerSessionId: string | null;
  expectedAmountKobo: number;
}

export type VerificationStatus = 'SUCCEEDED' | 'PENDING' | 'FAILED' | 'EXPIRED';

export interface VerifyPaymentResult {
  status: VerificationStatus;
  /** Amount the provider says was paid, in kobo (null if the provider did not report one). */
  amountKobo: number | null;
  /** True only when the paid amount equals the order's amount due (or the provider reported none for a server-priced session). */
  amountMatches: boolean;
}

export type WebhookOutcome = 'PAID' | 'FAILED' | 'EXPIRED' | 'IGNORED';

export interface ParsedWebhookEvent {
  eventId: string;
  type: string;
  outcome: WebhookOutcome;
  reference: string | null;
  sessionId: string | null;
  payload: unknown;
}

export type WebhookHeaders = Record<string, string | string[] | undefined>;

export class WebhookSignatureError extends Error {}
export class PaymentProviderError extends Error {
  constructor(
    message: string,
    public readonly providerStatus?: number,
  ) {
    super(message);
  }
}

/**
 * PAY-2: every payment provider sits behind this interface. Checkout, webhooks and verification never
 * know which concrete provider they are talking to.
 */
export interface PaymentProvider {
  readonly code: ProviderCode;
  readonly displayName: string;
  isConfigured(): boolean;
  initialize(input: InitializePaymentInput): Promise<InitializePaymentResult>;
  verify(input: VerifyPaymentInput): Promise<VerifyPaymentResult>;
  /** Verifies the signature over the RAW body and normalises the event. Throws WebhookSignatureError. */
  parseWebhook(rawBody: Buffer, headers: WebhookHeaders): ParsedWebhookEvent;
  // PAY-7: no refund method by design — the store never refunds money; returns are exchange credit only.
}

export function header(headers: WebhookHeaders, name: string): string | null {
  const v = headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

export function parseJson(raw: Buffer): Record<string, unknown> {
  try {
    const v = JSON.parse(raw.toString('utf8'));
    if (v && typeof v === 'object') return v as Record<string, unknown>;
  } catch {
    /* fallthrough */
  }
  throw new WebhookSignatureError('Malformed JSON body');
}
