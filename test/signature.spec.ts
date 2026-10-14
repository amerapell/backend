import { createHmac } from 'crypto';
import { computeBachsSignature, parseBachsV2Header, verifyBachsSignature, verifyPaystackSignature } from '../src/payments/signature';

describe('Paystack webhook signature (HMAC-SHA512 of raw body)', () => {
  const secret = 'sk_test_abc123';
  const body = Buffer.from(JSON.stringify({ event: 'charge.success', data: { id: 99, reference: 'AP-10501-x', amount: 18500000 } }));
  const sig = createHmac('sha512', secret).update(body).digest('hex');

  it('accepts the exact raw body', () => {
    expect(verifyPaystackSignature(body, sig, secret)).toBe(true);
  });
  it('accepts uppercase hex', () => {
    expect(verifyPaystackSignature(body, sig.toUpperCase(), secret)).toBe(true);
  });
  it('rejects a tampered body (re-serialised JSON is not the raw body)', () => {
    const tampered = Buffer.from(body.toString().replace('18500000', '100'));
    expect(verifyPaystackSignature(tampered, sig, secret)).toBe(false);
  });
  it('rejects wrong secret, missing and malformed signatures', () => {
    expect(verifyPaystackSignature(body, createHmac('sha512', 'other').update(body).digest('hex'), secret)).toBe(false);
    expect(verifyPaystackSignature(body, undefined, secret)).toBe(false);
    expect(verifyPaystackSignature(body, 'not-hex!', secret)).toBe(false);
    expect(verifyPaystackSignature(body, sig.slice(0, 64), secret)).toBe(false);
  });
});

describe('Bachs webhook signature v2 (HMAC-SHA256 of `${t}.${rawBody}`, 300 s tolerance)', () => {
  const secret = 'whsec_test';
  const raw = '{"id":"evt_1","type":"collection.succeeded","data":{"checkout_id":"chk_1"}}';
  const t = 1_800_000_000;
  const good = computeBachsSignature(t, raw, secret);

  it('computes the documented HMAC', () => {
    expect(good).toBe(createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex'));
  });
  it('parses t and multiple v1 values', () => {
    expect(parseBachsV2Header(`t=${t},v1=aa,v1=bb`)).toEqual({ t, v1: ['aa', 'bb'] });
  });
  it('accepts a valid signature within tolerance', () => {
    expect(verifyBachsSignature(raw, { v2: `t=${t},v1=${good}` }, secret, t + 299)).toEqual({ ok: true, timestamp: t });
    expect(verifyBachsSignature(raw, { v2: `t=${t},v1=${good}` }, secret, t - 300).ok).toBe(true);
  });
  it('accepts when any of several v1 signatures matches (secret rotation)', () => {
    const old = computeBachsSignature(t, raw, 'old-secret');
    expect(verifyBachsSignature(raw, { v2: `t=${t},v1=${old},v1=${good}` }, secret, t).ok).toBe(true);
  });
  it('rejects outside the 300 s tolerance either way', () => {
    expect(verifyBachsSignature(raw, { v2: `t=${t},v1=${good}` }, secret, t + 301)).toEqual({ ok: false, reason: 'Signature timestamp outside tolerance' });
    expect(verifyBachsSignature(raw, { v2: `t=${t},v1=${good}` }, secret, t - 301).ok).toBe(false);
  });
  it('rejects a mismatched body or timestamp', () => {
    expect(verifyBachsSignature(raw + ' ', { v2: `t=${t},v1=${good}` }, secret, t).ok).toBe(false);
    expect(verifyBachsSignature(raw, { v2: `t=${t + 1},v1=${good}` }, secret, t).ok).toBe(false);
  });
  it('falls back to legacy X-Bachs-Timestamp + X-Bachs-Signature headers', () => {
    expect(verifyBachsSignature(raw, { timestamp: String(t), signature: good }, secret, t).ok).toBe(true);
    expect(verifyBachsSignature(raw, { timestamp: String(t), signature: 'deadbeef' }, secret, t).ok).toBe(false);
  });
  it('rejects missing headers or secret', () => {
    expect(verifyBachsSignature(raw, {}, secret, t)).toEqual({ ok: false, reason: 'Missing signature' });
    expect(verifyBachsSignature(raw, { v2: `v1=${good}` }, secret, t).ok).toBe(false);
    expect(verifyBachsSignature(raw, { v2: `t=${t},v1=${good}` }, '', t).ok).toBe(false);
  });
});
