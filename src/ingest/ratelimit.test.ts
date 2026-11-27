import { describe, expect, it } from 'vitest';
import { TokenBucket } from './ratelimit.js';

describe('TokenBucket', () => {
  it('allows bursts up to capacity, then waits for refill', async () => {
    const bucket = new TokenBucket(2, 1 / 50); // 1 token per 50ms
    const start = Date.now();
    await bucket.take();
    await bucket.take();
    expect(Date.now() - start).toBeLessThan(20);
    await bucket.take();
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });
});
