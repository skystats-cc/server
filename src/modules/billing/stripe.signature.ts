import { createHmac, timingSafeEqual } from 'node:crypto';

/** Verify a `Stripe-Signature` header (scheme v1, HMAC-SHA256 of `${t}.${body}`). */
export function verifyStripeSignature(rawBody: string, header: string | undefined, secret: string, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000)) {
  if (!header || !secret) return false;
  const pairs = header.split(',').map((kv) => kv.trim().split('=', 2) as [string, string | undefined]);
  const t = Number(pairs.find(([k]) => k === 't')?.[1]);
  const sigs = pairs.filter(([k, v]) => k === 'v1' && v).map(([, v]) => v as string);
  if (!Number.isFinite(t) || sigs.length === 0 || Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  return sigs.some((s) => {
    const got = Buffer.from(s, 'hex');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}
