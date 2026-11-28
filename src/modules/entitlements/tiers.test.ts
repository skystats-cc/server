import { describe, expect, it } from 'vitest';
import { deleteBefore, effectiveTier, featuresFor, hasFeature, visibleFrom } from './tiers.js';

const now = new Date('2026-12-01T00:00:00Z');
const day = 86_400_000;
const at = (d: number) => new Date(now.getTime() + d * day);

describe('effectiveTier', () => {
  it('is free without an entitlement', () => expect(effectiveTier(null, now)).toBe('free'));
  it('honours active and trialing', () => {
    expect(effectiveTier({ tier: 'pro', status: 'active', currentPeriodEnd: at(10), graceUntil: null }, now)).toBe('pro');
    expect(effectiveTier({ tier: 'max', status: 'trialing', currentPeriodEnd: at(3), graceUntil: null }, now)).toBe('max');
  });
  it('keeps the tier during payment grace only', () => {
    expect(effectiveTier({ tier: 'pro', status: 'past_due', currentPeriodEnd: null, graceUntil: at(2) }, now)).toBe('pro');
    expect(effectiveTier({ tier: 'pro', status: 'past_due', currentPeriodEnd: null, graceUntil: at(-1) }, now)).toBe('free');
  });
  it('keeps a cancelled tier until the paid period ends', () => {
    expect(effectiveTier({ tier: 'max', status: 'canceled', currentPeriodEnd: at(5), graceUntil: null }, now)).toBe('max');
    expect(effectiveTier({ tier: 'max', status: 'canceled', currentPeriodEnd: at(-5), graceUntil: null }, now)).toBe('free');
  });
  it('ignores unknown tiers', () =>
    expect(effectiveTier({ tier: 'gold', status: 'active', currentPeriodEnd: null, graceUntil: null }, now)).toBe('free'));
});

describe('features', () => {
  it('keeps outage alerts free and price alerts Pro+', () => {
    expect(hasFeature('free', 'alerts.hypixel_outage')).toBe(true);
    expect(hasFeature('free', 'alerts.price')).toBe(false);
    expect(hasFeature('pro', 'alerts.price')).toBe(true);
    expect(hasFeature('pro', 'mmm.custom')).toBe(false);
    expect(featuresFor('max')).toContain('mmm.beta');
  });
  it('never paywalls the data export', () => expect(hasFeature('free', 'data.export_csv')).toBe(true));
});

describe('retention', () => {
  it('shows 7 / 90 / unlimited days', () => {
    expect(visibleFrom('free', now)).toEqual(at(-7));
    expect(visibleFrom('pro', now)).toEqual(at(-90));
    expect(visibleFrom('max', now)).toBeNull();
  });
  it('only hides data inside the soft window after a downgrade', () => {
    expect(deleteBefore('free', at(-10), 30, now)).toBeNull();
    expect(deleteBefore('free', at(-31), 30, now)).toEqual(at(-7));
    expect(deleteBefore('free', null, 30, now)).toEqual(at(-7));
    expect(deleteBefore('max', null, 30, now)).toBeNull();
  });
});
