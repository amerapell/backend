import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';
import { verifyPaystackSignature } from '../signature';
import {
  FetchFn,
  header,
  HTTP_FETCH,
  InitializePaymentInput,
  InitializePaymentResult,
  ParsedWebhookEvent,
  parseJson,
  PaymentProvider,
  PaymentProviderError,
  VerificationStatus,
  VerifyPaymentInput,
  VerifyPaymentResult,
  WebhookHeaders,
  WebhookSignatureError,
} from '../payment-provider';

const BASE = 'https://api.paystack.co';

interface PaystackEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
}

/** Paystack adds `reference` and `trxref` to the callback URL itself; a second `reference` would arrive as a list. */
export function withoutReference(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete('reference');
    u.searchParams.delete('trxref');
    return u.toString();
  } catch {
    return url;
  }
}

export function mapPaystackStatus(status: string | undefined): VerificationStatus {
  switch ((status ?? '').toLowerCase()) {
    case 'success':
      return 'SUCCEEDED';
    case 'failed':
    case 'reversed':
      return 'FAILED';
    default:
      // abandoned / ongoing / pending / processing / queued — not final yet
      return 'PENDING';
  }
}

/** Paystack (NGN: card, bank transfer, USSD). Amounts are integer kobo. */
@Injectable()
export class PaystackProvider implements PaymentProvider {
  readonly code = 'PAYSTACK' as const;
  readonly displayName = 'Paystack';
  private readonly logger = new Logger('PaystackProvider');

  constructor(
    private readonly config: AppConfig,
    @Inject(HTTP_FETCH) private readonly fetchFn: FetchFn,
  ) {}

  isConfigured(): boolean {
    return !!this.config.values.paystackSecretKey;
  }

  private get secret(): string {
    const key = this.config.values.paystackSecretKey;
    if (!key) throw new PaymentProviderError('Paystack is not configured');
    return key;
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await this.fetchFn(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.secret}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => null)) as PaystackEnvelope<T> | null;
    if (!res.ok || !json || json.status !== true) {
      const msg = json?.message ?? `HTTP ${res.status}`;
      this.logger.warn(`Paystack ${method} ${path} failed: ${msg}`);
      throw new PaymentProviderError(`Paystack: ${msg}`, res.status);
    }
    return json.data;
  }

  async initialize(input: InitializePaymentInput): Promise<InitializePaymentResult> {
    const data = await this.call<{ authorization_url: string; reference: string }>('POST', '/transaction/initialize', {
      email: input.email,
      amount: input.amountKobo,
      currency: 'NGN',
      reference: input.reference,
      callback_url: withoutReference(input.callbackUrl),
      metadata: { orderNumber: input.orderNumber, orderId: input.orderId, cancel_action: input.cancelUrl },
      channels: ['card', 'bank', 'ussd', 'bank_transfer'],
    });
    return { authorizationUrl: data.authorization_url, reference: data.reference ?? input.reference, providerSessionId: null };
  }

  async verify(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    const data = await this.call<{ status: string; amount: number; currency: string; reference: string }>(
      'GET',
      `/transaction/verify/${encodeURIComponent(input.reference)}`,
    );
    const status = mapPaystackStatus(data.status);
    const amountKobo = typeof data.amount === 'number' ? data.amount : null;
    const currencyOk = !data.currency || data.currency.toUpperCase() === 'NGN';
    return { status, amountKobo, amountMatches: currencyOk && amountKobo === input.expectedAmountKobo };
  }

  parseWebhook(rawBody: Buffer, headers: WebhookHeaders): ParsedWebhookEvent {
    if (!verifyPaystackSignature(rawBody, header(headers, 'x-paystack-signature'), this.secret)) {
      throw new WebhookSignatureError('Invalid Paystack signature');
    }
    const body = parseJson(rawBody);
    const event = String(body.event ?? 'unknown');
    const data = (body.data ?? {}) as Record<string, unknown>;
    const reference = typeof data.reference === 'string' ? data.reference : null;
    const id = data.id ?? reference ?? 'none';
    return {
      eventId: `${event}:${String(id)}`,
      type: event,
      outcome: event === 'charge.success' ? 'PAID' : 'IGNORED',
      reference,
      sessionId: null,
      payload: body,
    };
  }
}
