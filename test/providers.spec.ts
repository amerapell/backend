import { createHmac } from 'crypto';
import { PaystackProvider, mapPaystackStatus } from '../src/payments/paystack/paystack.provider';
import { BachsProvider, mapBachsSessionStatus, bachsSessionAmountKobo } from '../src/payments/bachs/bachs.provider';
import { extractCheckoutUrl, unwrap } from '../src/payments/bachs/bachs.client';
import { PaymentProviderRegistry } from '../src/payments/payment-provider.registry';
import { WebhookSignatureError, PaymentProviderError } from '../src/payments/payment-provider';
import { computeBachsSignature } from '../src/payments/signature';
import { FakeClock, fakeFetch, settingsService, testConfig } from './fakes';

const init = {
  orderId: 'o1',
  orderNumber: 'AP-10501',
  email: 'ada@example.com',
  amountKobo: 18_950_000,
  reference: 'AP-10501-abc',
  callbackUrl: 'https://shop.test/checkout/complete?reference=AP-10501-abc',
  cancelUrl: 'https://shop.test/checkout?cancelled=1',
};

describe('PaystackProvider', () => {
  const config = testConfig({ PAYSTACK_SECRET_KEY: 'sk_test_x' });

  it('initialises with integer kobo, NGN and the frontend callback URL', async () => {
    const f = fakeFetch({
      'POST /transaction/initialize': { body: { status: true, message: 'ok', data: { authorization_url: 'https://checkout.paystack.com/abc', reference: 'AP-10501-abc' } } },
    });
    const p = new PaystackProvider(config, f.fn);
    const res = await p.initialize(init);
    expect(res).toEqual({ authorizationUrl: 'https://checkout.paystack.com/abc', reference: 'AP-10501-abc', providerSessionId: null });
    expect(f.calls[0].body).toMatchObject({ amount: 18_950_000, currency: 'NGN', reference: 'AP-10501-abc', callback_url: init.callbackUrl, email: init.email });
    expect(f.calls[0].headers.Authorization).toBe('Bearer sk_test_x');
  });

  it('verify: success only counts when the amount matches', async () => {
    const f = fakeFetch({ 'GET /transaction/verify/AP-10501-abc': { body: { status: true, message: 'ok', data: { status: 'success', amount: 18_950_000, currency: 'NGN', reference: 'AP-10501-abc' } } } });
    const p = new PaystackProvider(config, f.fn);
    expect(await p.verify({ reference: 'AP-10501-abc', providerSessionId: null, expectedAmountKobo: 18_950_000 })).toEqual({ status: 'SUCCEEDED', amountKobo: 18_950_000, amountMatches: true });
    expect((await p.verify({ reference: 'AP-10501-abc', providerSessionId: null, expectedAmountKobo: 19_000_000 })).amountMatches).toBe(false);
  });

  it('maps statuses', () => {
    expect(mapPaystackStatus('success')).toBe('SUCCEEDED');
    expect(mapPaystackStatus('failed')).toBe('FAILED');
    expect(mapPaystackStatus('abandoned')).toBe('PENDING');
    expect(mapPaystackStatus('ongoing')).toBe('PENDING');
  });

  it('surfaces API errors as PaymentProviderError', async () => {
    const f = fakeFetch({ 'POST /transaction/initialize': { status: 400, body: { status: false, message: 'Invalid key' } } });
    await expect(new PaystackProvider(config, f.fn).initialize(init)).rejects.toBeInstanceOf(PaymentProviderError);
  });

  it('parses a signed charge.success webhook and rejects bad signatures', () => {
    const p = new PaystackProvider(config, fakeFetch({}).fn);
    const raw = Buffer.from(JSON.stringify({ event: 'charge.success', data: { id: 4099, reference: 'AP-10501-abc', amount: 18_950_000 } }));
    const sig = createHmac('sha512', 'sk_test_x').update(raw).digest('hex');
    expect(p.parseWebhook(raw, { 'x-paystack-signature': sig })).toMatchObject({
      eventId: 'charge.success:4099',
      outcome: 'PAID',
      reference: 'AP-10501-abc',
    });
    expect(() => p.parseWebhook(raw, { 'x-paystack-signature': 'bad' })).toThrow(WebhookSignatureError);
    const other = Buffer.from(JSON.stringify({ event: 'transfer.success', data: { id: 1 } }));
    expect(p.parseWebhook(other, { 'x-paystack-signature': createHmac('sha512', 'sk_test_x').update(other).digest('hex') }).outcome).toBe('IGNORED');
  });
});

describe('BachsProvider', () => {
  const clock = new FakeClock();
  const config = testConfig({ BACHS_API_KEY: 'sk_sandbox_123', BACHS_WEBHOOK_SECRET: 'whsec_1' });

  it('picks sandbox vs live base URL from the key prefix or BACHS_ENV', () => {
    expect(new BachsProvider(config, fakeFetch({}).fn, clock).baseUrl).toBe('https://sandbox-api.bachs.io');
    expect(new BachsProvider(testConfig({ BACHS_API_KEY: 'sk_live_9' }), fakeFetch({}).fn, clock).baseUrl).toBe('https://api.bachs.io');
    expect(new BachsProvider(testConfig({ BACHS_API_KEY: 'sk_live_9', BACHS_ENV: 'sandbox' }), fakeFetch({}).fn, clock).baseUrl).toBe('https://sandbox-api.bachs.io');
  });

  it('creates a one-off product priced as a decimal string, then a checkout session', async () => {
    const f = fakeFetch({
      'POST /v1/products': { body: { id: 'prod_1' } },
      'POST /v1/checkout-sessions': { body: { checkout_id: 'chk_9', checkout_url: 'https://pay.bachs.io/chk_9', status: 'open' } },
    });
    const res = await new BachsProvider(config, f.fn, clock).initialize(init);
    expect(res).toEqual({ authorizationUrl: 'https://pay.bachs.io/chk_9', reference: 'AP-10501-abc', providerSessionId: 'chk_9' });
    expect(f.calls[0].url).toBe('https://sandbox-api.bachs.io/v1/products');
    expect(f.calls[0].body).toEqual({ name: 'Amerapelle order AP-10501', price: { amount: '189500.00', currency: 'NGN' } });
    expect(f.calls[1].body).toMatchObject({
      product_cart: [{ product_id: 'prod_1', quantity: 1 }],
      customer: { email: 'ada@example.com' },
      success_url: init.callbackUrl,
      cancel_url: init.cancelUrl,
      reference: 'AP-10501-abc',
    });
  });

  it('supports pricing mode (BACHS_CHECKOUT_MODE=pricing)', async () => {
    const f = fakeFetch({ 'POST /v1/checkout-sessions': { body: { data: { id: 'chk_2', url: 'https://pay/2' } } } });
    const p = new BachsProvider(testConfig({ BACHS_API_KEY: 'sk_sandbox_1', BACHS_CHECKOUT_MODE: 'pricing' }), f.fn, clock);
    expect((await p.initialize(init)).providerSessionId).toBe('chk_2');
    expect(f.calls[0].body).toMatchObject({ pricing: { amount: '189500.00', currency: 'NGN' } });
  });

  it('extracts the checkout URL from url ?? checkout_url ?? hosted_url', () => {
    expect(extractCheckoutUrl({ url: 'a', checkout_url: 'b' })).toBe('a');
    expect(extractCheckoutUrl({ checkout_url: 'b', hosted_url: 'c' })).toBe('b');
    expect(extractCheckoutUrl({ hosted_url: 'c' })).toBe('c');
    expect(extractCheckoutUrl({})).toBeNull();
    expect(unwrap({ data: { id: 'x' } })).toEqual({ id: 'x' });
  });

  it('verify re-fetches the session and checks the amount', async () => {
    const f = fakeFetch({ 'GET /v1/checkout-sessions/chk_9': { body: { checkout_id: 'chk_9', status: 'complete', amount_total: '189500.00', currency: 'NGN' } } });
    const p = new BachsProvider(config, f.fn, clock);
    expect(await p.verify({ reference: 'r', providerSessionId: 'chk_9', expectedAmountKobo: 18_950_000 })).toEqual({ status: 'SUCCEEDED', amountKobo: 18_950_000, amountMatches: true });
    expect((await p.verify({ reference: 'r', providerSessionId: 'chk_9', expectedAmountKobo: 1 })).amountMatches).toBe(false);
    expect(f.calls).toHaveLength(2);
  });

  it('maps session statuses and amounts', () => {
    expect(mapBachsSessionStatus({ status: 'open' })).toBe('PENDING');
    expect(mapBachsSessionStatus({ status: 'expired' })).toBe('EXPIRED');
    expect(mapBachsSessionStatus({ status: 'open', payment_status: 'paid' })).toBe('SUCCEEDED');
    expect(bachsSessionAmountKobo({ pricing: { amount: '10.50', currency: 'USD' } })).toEqual({ amountKobo: 1050, currency: 'USD' });
  });

  it('parses signed webhooks (v2 header, 300 s tolerance)', () => {
    const p = new BachsProvider(config, fakeFetch({}).fn, clock);
    const raw = JSON.stringify({ id: 'evt_3ab', type: 'collection.succeeded', created_at: '2026-10-13T12:00:00Z', data: { checkout_id: 'chk_9', status: 'SUCCEEDED', amount: '189500.00', currency: 'NGN' } });
    const t = Math.floor(clock.now().getTime() / 1000);
    const sig = computeBachsSignature(t, raw, 'whsec_1');
    expect(p.parseWebhook(Buffer.from(raw), { 'x-bachs-signature-v2': `t=${t},v1=${sig}` })).toMatchObject({ eventId: 'evt_3ab', outcome: 'PAID', sessionId: 'chk_9' });
    expect(() => p.parseWebhook(Buffer.from(raw), { 'x-bachs-signature-v2': `t=${t - 400},v1=${computeBachsSignature(t - 400, raw, 'whsec_1')}` })).toThrow(WebhookSignatureError);
    const expired = JSON.stringify({ id: 'evt_4', type: 'checkout.expired', data: { checkout_id: 'chk_9' } });
    expect(p.parseWebhook(Buffer.from(expired), { 'x-bachs-signature-v2': `t=${t},v1=${computeBachsSignature(t, expired, 'whsec_1')}` }).outcome).toBe('EXPIRED');
  });
});

describe('PaymentProviderRegistry (PAY-2)', () => {
  const clock = new FakeClock();
  const cfg = testConfig({ PAYSTACK_SECRET_KEY: 'sk', BACHS_API_KEY: 'sk_sandbox_1' });
  const providers = [new PaystackProvider(cfg, fakeFetch({}).fn), new BachsProvider(cfg, fakeFetch({}).fn, clock)];

  it('resolves by code and honours the admin toggles', async () => {
    const reg = new PaymentProviderRegistry(providers, settingsService({ paystackEnabled: true, bachsEnabled: false }));
    expect(reg.get('BACHS').code).toBe('BACHS');
    expect((await reg.getEnabled('PAYSTACK')).code).toBe('PAYSTACK');
    await expect(reg.getEnabled('BACHS')).rejects.toThrow('Bachs is currently unavailable');
  });

  it('treats an unconfigured provider as disabled', async () => {
    const bare = testConfig();
    const reg = new PaymentProviderRegistry([new PaystackProvider(bare, fakeFetch({}).fn)], settingsService());
    expect(await reg.isEnabled('PAYSTACK')).toBe(false);
    expect(() => reg.get('BACHS')).toThrow('Unknown payment provider');
  });
});
