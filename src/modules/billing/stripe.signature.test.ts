import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyStripeSignature } from './stripe.signature.js';

const secret = 'whsec_test';
const body = '{"id":"evt_1"}';
const sign = (t: number, b = body) => createHmac('sha256', secret).update(`${t}.${b}`).digest('hex');

describe('verifyStripeSignature', () => {
  it('accepts a valid signature', () => {
    expect(verifyStripeSignature(body, `t=1000,v1=${sign(1000)}`, secret, 300, 1100)).toBe(true);
  });
  it('rejects a tampered body, wrong secret, old timestamp or missing header', () => {
    expect(verifyStripeSignature('{"id":"evt_2"}', `t=1000,v1=${sign(1000)}`, secret, 300, 1100)).toBe(false);
    expect(verifyStripeSignature(body, `t=1000,v1=${sign(1000)}`, 'whsec_other', 300, 1100)).toBe(false);
    expect(verifyStripeSignature(body, `t=1000,v1=${sign(1000)}`, secret, 300, 2000)).toBe(false);
    expect(verifyStripeSignature(body, undefined, secret)).toBe(false);
  });
});
