import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';
import { CLOCK, Clock } from '../../common/clock';
import { decimalStringToKobo, koboToDecimalString } from '../../common/money';
import { verifyBachsSignature } from '../signature';
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
  WebhookOutcome,
  WebhookSignatureError,
} from '../payment-provider';
import { BACHS_BASE_URLS, BachsClient, BachsObject, extractCheckoutUrl, extractSessionId } from './bachs.client';

export function mapBachsSessionStatus(session: BachsObject): VerificationStatus {
  const s = String(session.status ?? '').toLowerCase();
  const ps = String(session.payment_status ?? '').toLowerCase();
  if (['complete', 'completed', 'paid', 'succeeded', 'success'].includes(s) || ps === 'paid' || ps === 'succeeded') return 'SUCCEEDED';
  if (s === 'expired') return 'EXPIRED';
  if (['failed', 'canceled', 'cancelled'].includes(s)) return 'FAILED';
  return 'PENDING';
}

/** Reads the session's amount (decimal string) in kobo, or null if not reported. */
export function bachsSessionAmountKobo(session: BachsObject): { amountKobo: number | null; currency: string | null } {
  const pricing = session.pricing as BachsObject | undefined;
  const raw = session.amount_total ?? session.amount ?? session.total ?? pricing?.amount ?? null;
  const currency = (session.currency ?? pricing?.currency ?? null) as string | null;
  if (raw === null || raw === undefined) return { amountKobo: null, currency };
  try {
    return { amountKobo: decimalStringToKobo(raw as string), currency };
  } catch {
    return { amountKobo: null, currency };
  }
}

const OUTCOMES: Record<string, WebhookOutcome> = {
  'checkout.completed': 'PAID',
  'collection.succeeded': 'PAID',
  'collection.failed': 'FAILED',
  'checkout.expired': 'EXPIRED',
};

/** Bachs: foreign cards, transfers, USDT/USDC; settles NGN. Amounts are decimal strings. */
@Injectable()
export class BachsProvider implements PaymentProvider {
  readonly code = 'BACHS' as const;
  readonly displayName = 'Bachs';
  private readonly logger = new Logger('BachsProvider');
  private clientInstance: BachsClient | null = null;

  constructor(
    private readonly config: AppConfig,
    @Inject(HTTP_FETCH) private readonly fetchFn: FetchFn,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  isConfigured(): boolean {
    return !!this.config.values.bachsApiKey;
  }

  get baseUrl(): string {
    return BACHS_BASE_URLS[this.config.values.bachsEnv];
  }

  private get client(): BachsClient {
    const key = this.config.values.bachsApiKey;
    if (!key) throw new PaymentProviderError('Bachs is not configured');
    this.clientInstance ??= new BachsClient(key, this.baseUrl, this.fetchFn);
    return this.clientInstance;
  }

  async initialize(input: InitializePaymentInput): Promise<InitializePaymentResult> {
    const amount = koboToDecimalString(input.amountKobo);
    const metadata = { orderNumber: input.orderNumber, orderId: input.orderId, reference: input.reference };
    const common = { email: input.email, successUrl: input.callbackUrl, cancelUrl: input.cancelUrl, reference: input.reference, metadata };
    const session =
      this.config.values.bachsCheckoutMode === 'pricing'
        ? await this.client.createCheckoutSession({ ...common, pricing: { amount, currency: 'NGN' } })
        : await this.client.createCheckoutSession({
            ...common,
            productId: await this.client.createOrderProduct(input.orderNumber, amount, input.reference),
          });
    const url = extractCheckoutUrl(session);
    const sessionId = extractSessionId(session);
    if (!url || !sessionId) throw new PaymentProviderError('Bachs: checkout URL or id missing in response');
    return { authorizationUrl: url, reference: input.reference, providerSessionId: sessionId };
  }

  /** Always re-fetches the checkout session from the API before anything is marked PAID. */
  async verify(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    if (!input.providerSessionId) return { status: 'PENDING', amountKobo: null, amountMatches: false };
    const session = await this.client.getCheckoutSession(input.providerSessionId);
    const status = mapBachsSessionStatus(session);
    const { amountKobo, currency } = bachsSessionAmountKobo(session);
    const currencyOk = !currency || currency.toUpperCase() === 'NGN';
    if (amountKobo === null && status === 'SUCCEEDED') {
      this.logger.warn(`Bachs session ${input.providerSessionId} reported no amount; trusting server-created price`);
    }
    const amountMatches = currencyOk && (amountKobo === null || amountKobo === input.expectedAmountKobo);
    return { status, amountKobo, amountMatches };
  }

  parseWebhook(rawBody: Buffer, headers: WebhookHeaders): ParsedWebhookEvent {
    const secret = this.config.values.bachsWebhookSecret;
    if (!secret) throw new WebhookSignatureError('Bachs webhook secret not configured');
    const result = verifyBachsSignature(
      rawBody,
      {
        v2: header(headers, 'x-bachs-signature-v2'),
        timestamp: header(headers, 'x-bachs-timestamp'),
        signature: header(headers, 'x-bachs-signature'),
      },
      secret,
      Math.floor(this.clock.now().getTime() / 1000),
    );
    if (!result.ok) throw new WebhookSignatureError(result.reason);
    const body = parseJson(rawBody);
    const type = String(body.type ?? 'unknown');
    const data = (body.data ?? {}) as BachsObject;
    const meta = (data.metadata ?? {}) as BachsObject;
    const checkout = (data.checkout ?? {}) as BachsObject;
    const dataId = typeof data.id === 'string' && data.id.startsWith('chk_') ? data.id : null;
    const sessionId = (data.checkout_id ?? data.checkout_session_id ?? checkout.id ?? dataId ?? null) as string | null;
    const reference = (data.reference ?? meta.reference ?? checkout.reference ?? null) as string | null;
    const eventId = typeof body.id === 'string' ? body.id : `${type}:${sessionId ?? reference ?? 'none'}`;
    return { eventId, type, outcome: OUTCOMES[type] ?? 'IGNORED', reference, sessionId, payload: body };
  }
}
