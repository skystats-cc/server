import { describe, expect, it } from 'vitest';
import { classifyActivity, classifyDelta, coinsPerHour, milestones } from './insight.js';

const c = (purse: number, bank = 0, coop = 0, xp = 100) => ({ purse, personalBank: bank, profileBank: coop, skyblockXp: xp });

describe('classifyDelta', () => {
  it('treats purse-to-bank moves as transfers', () => {
    expect(classifyDelta(c(1_000_000, 0), c(0, 1_000_000)).kind).toBe('transfer');
    expect(classifyDelta(c(500_000, 0, 0), c(100_000, 0, 400_000)).kind).toBe('transfer');
  });
  it('separates income and spending', () => {
    expect(classifyDelta(c(100), c(350))).toEqual({ kind: 'normal', income: 250, spending: 0 });
    expect(classifyDelta(c(1000, 500), c(200, 500))).toEqual({ kind: 'normal', income: 0, spending: 800 });
  });
  it('detects a profile reset', () => {
    expect(classifyDelta(c(5e8, 5e8, 0, 300), c(100, 0, 0, 0)).kind).toBe('reset');
    expect(classifyDelta(c(5e8, 0, 0, 300), c(100, 0, 0, 300)).kind).toBe('normal');
  });
});

describe('milestones', () => {
  it('finds the first day at each level', () => {
    expect(milestones([{ day: 'a', close: 5e5 }, { day: 'b', close: 2e6 }, { day: 'c', close: 1.2e7 }])).toEqual([
      { amount: 1e6, day: 'b' },
      { amount: 1e7, day: 'c' },
    ]);
  });
});

describe('activity and rates', () => {
  it('needs a clear majority', () => {
    expect(classifyActivity(['FARMING', 'farming', 'MINING'])).toBe('farming');
    expect(classifyActivity(['FARMING', 'MINING'])).toBeNull();
    expect(classifyActivity([null])).toBeNull();
  });
  it('computes coins per hour', () => {
    expect(coinsPerHour(100, 1100, 30 * 60_000)).toBe(2000);
    expect(coinsPerHour(100, 1100, 60_000)).toBeNull();
  });
});
