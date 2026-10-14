import { createHmac, timingSafeEqual } from 'crypto';

export function safeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
  const ab = Buffer.from(a.toLowerCase(), 'hex');
  const bb = Buffer.from(b.toLowerCase(), 'hex');
  if (ab.length !== bb.length || ab.length === 0) return false;
  return timingSafeEqual(ab, bb);
}

/** Paystack: `x-paystack-signature` = HMAC-SHA512 hex of the raw request body keyed with the secret key. */
export function verifyPaystackSignature(rawBody: Buffer | string, signature: string | undefined | null, secretKey: string): boolean {
  if (!signature || !secretKey) return false;
  const expected = createHmac('sha512', secretKey).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature.trim());
}

export interface BachsSignatureHeaders {
  /** `X-Bachs-Signature-V2: t=<ts>,v1=<sig>[,v1=<sig2>]` (preferred). */
  v2?: string | null;
  /** Legacy pair: `X-Bachs-Timestamp` + `X-Bachs-Signature`. */
  timestamp?: string | null;
  signature?: string | null;
}

export type BachsVerification = { ok: true; timestamp: number } | { ok: false; reason: string };

export function parseBachsV2Header(header: string): { t: number | null; v1: string[] } {
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === 't' && /^\d+$/.test(v)) t = Number(v);
    else if (k === 'v1' && v) v1.push(v);
  }
  return { t, v1 };
}

export function computeBachsSignature(timestamp: number | string, rawBody: Buffer | string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex');
}

/**
 * Bachs: hex HMAC-SHA256 of `${t}.${rawBody}`; reject if |now − t| > tolerance (300 s); accept if any v1 matches
 * (constant-time). Falls back to the legacy headers when V2 is absent.
 */
export function verifyBachsSignature(
  rawBody: Buffer | string,
  headers: BachsSignatureHeaders,
  secret: string,
  nowSeconds: number,
  toleranceSeconds = 300,
): BachsVerification {
  if (!secret) return { ok: false, reason: 'Webhook secret not configured' };
  let t: number | null = null;
  let candidates: string[] = [];
  if (headers.v2) {
    const parsed = parseBachsV2Header(headers.v2);
    t = parsed.t;
    candidates = parsed.v1;
  } else if (headers.timestamp && headers.signature) {
    t = /^\d+$/.test(headers.timestamp.trim()) ? Number(headers.timestamp.trim()) : null;
    candidates = [headers.signature.trim()];
  }
  if (t === null || candidates.length === 0) return { ok: false, reason: 'Missing signature' };
  if (Math.abs(nowSeconds - t) > toleranceSeconds) return { ok: false, reason: 'Signature timestamp outside tolerance' };
  const expected = computeBachsSignature(t, rawBody, secret);
  const match = candidates.some((c) => safeEqualHex(expected, c));
  return match ? { ok: true, timestamp: t } : { ok: false, reason: 'Signature mismatch' };
}
