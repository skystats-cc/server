import { describe, expect, it } from 'vitest';
import { bucket, flagOn } from './flags.js';

describe('feature flags', () => {
  const f = { key: 'new-chart', enabled: true, minTier: null, rolloutPercent: 100 };
  it('respects enabled, tier and rollout', () => {
    expect(flagOn(f, null, 'free')).toBe(true);
    expect(flagOn({ ...f, enabled: false }, 'a', 'max')).toBe(false);
    expect(flagOn({ ...f, minTier: 'pro' }, 'a', 'free')).toBe(false);
    expect(flagOn({ ...f, rolloutPercent: 0 }, 'a', 'max')).toBe(false);
    expect(flagOn({ ...f, rolloutPercent: 50 }, null, 'max')).toBe(false);
  });
  it('buckets deterministically and roughly evenly', () => {
    expect(bucket('k', 'acc')).toBe(bucket('k', 'acc'));
    const n = Array.from({ length: 2000 }, (_, i) => bucket('k', `acc${i}`)).filter((b) => b < 50).length;
    expect(n).toBeGreaterThan(850);
    expect(n).toBeLessThan(1150);
  });
});
