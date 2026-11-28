import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';





import { cronIntervalMinutes, newGiftCode, signPayload } from './helpers.js';

describe('platform helpers', () => {
  it('signs webhooks like Stripe (t=…,v1=…)', () => {
    const sig = signPayload('whsec_x', '{"a":1}', 1700000000);
    expect(sig).toBe(`t=1700000000,v1=${createHmac('sha256', 'whsec_x').update('1700000000.{"a":1}').digest('hex')}`);
  });
  it('makes readable gift codes', () => {
    expect(newGiftCode()).toMatch(/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
  });
  it('reads simple cron intervals', () => {
    expect(cronIntervalMinutes('*/15 * * * *')).toBe(15);
    expect(cronIntervalMinutes('7 * * * *')).toBe(60);
    expect(cronIntervalMinutes('37 3 * * *')).toBe(1440);
    expect(cronIntervalMinutes('0 9 * * 1')).toBe(10080);
    expect(cronIntervalMinutes('0 9 1 * *')).toBeNull();
  });
});
