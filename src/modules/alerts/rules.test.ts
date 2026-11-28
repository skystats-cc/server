import { describe, expect, it } from 'vitest';
import { deliverAfter, localMinutes, manipulationSignal, priceCondition, robustZ, stepRule } from './rules.js';

const t = (iso: string) => new Date(iso);

describe('price rules', () => {
  it('checks above/below', () => {
    expect(priceCondition('above', 100, 100)).toBe(true);
    expect(priceCondition('below', 100, 101)).toBe(false);
  });
  it('fires once, re-arms when the condition clears, honours cooldown', () => {
    const now = t('2026-12-01T12:00:00Z');
    let r = { armed: true, lastFiredAt: null as Date | null, cooldownMinutes: 60 };
    expect(stepRule(r, true, now)).toEqual({ fire: true, armed: false });
    r = { ...r, armed: false, lastFiredAt: now };
    expect(stepRule(r, true, now).fire).toBe(false); // still true: no repeat
    expect(stepRule(r, false, now)).toEqual({ fire: false, armed: true }); // clears: re-arm
    r = { ...r, armed: true };
    expect(stepRule(r, true, t('2026-12-01T12:30:00Z')).fire).toBe(false); // cooldown
    expect(stepRule(r, true, t('2026-12-01T13:00:00Z')).fire).toBe(true);
  });
});

describe('anomalies', () => {
  const hist = Array.from({ length: 30 }, (_, i) => 1000 * (1 + 0.01 * Math.sin(i)));
  it('flags a big move and ignores normal noise', () => {
    expect(Math.abs(robustZ(hist, 1005)!)).toBeLessThan(3);
    expect(robustZ(hist, 2000)!).toBeGreaterThan(10);
    expect(robustZ(hist.slice(0, 5), 2000)).toBeNull();
  });
  it('spots order walls without naming anyone', () => {
    const h = Array.from({ length: 20 }, () => ({ buyOrders: 50, sellOrders: 40, buyVolume: 1000, sellVolume: 900 }));
    expect(manipulationSignal(h, { buyOrders: 50, sellOrders: 40, buyVolume: 1000, sellVolume: 9000 })).toMatch(/sell-offer volume is 10×/);
    expect(manipulationSignal(h, { buyOrders: 55, sellOrders: 41, buyVolume: 1200, sellVolume: 950 })).toBeNull();
  });
});

describe('quiet hours', () => {
  it('reads local time', () => {
    expect(localMinutes(t('2026-07-01T21:30:00Z'), 'Europe/London')).toBe(22 * 60 + 30); // BST
    expect(localMinutes(t('2026-12-01T21:30:00Z'), 'Europe/London')).toBe(21 * 60 + 30); // GMT
  });
  it('delays to the end of overnight quiet hours', () => {
    const q = { start: 22 * 60, end: 7 * 60, timeZone: 'Europe/London' };
    expect(deliverAfter(t('2026-12-01T23:00:00Z'), q)).toEqual(t('2026-12-02T07:00:00Z'));
    expect(deliverAfter(t('2026-12-01T12:00:00Z'), q)).toEqual(t('2026-12-01T12:00:00Z'));
    expect(deliverAfter(t('2026-12-01T12:00:00Z'), { start: null, end: null, timeZone: 'UTC' })).toEqual(t('2026-12-01T12:00:00Z'));
  });
});
