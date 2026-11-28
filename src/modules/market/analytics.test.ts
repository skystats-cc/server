import { describe, expect, it } from 'vitest';
import { cheapest, correlation, economyIndex, evaluateMethod, flips, npcArbitrage, seasonality, type Recipe } from './analytics.js';

const q = (id: string, buy: number, sell: number, vol = 16800) => ({ productId: id, buyPrice: buy, sellPrice: sell, buyMovingWeek: vol, sellMovingWeek: vol });

describe('market analytics', () => {
  it('ranks profitable flips after tax', () => {
    const f = flips([q('A', 110, 100), q('B', 100.5, 100), q('C', 200, 100, 0)], 0.0125);
    expect(f.map((x) => x.productId)).toEqual(['A']);
    expect(f[0]!.hourlyVolume).toBe(100);
    expect(f[0]!.margin).toBeCloseTo(109.9 * 0.9875 - 100.1, 5);
  });
  it('finds NPC arbitrage', () => {
    expect(npcArbitrage([q('A', 5, 4), q('B', 10, 9)], new Map([['A', 8], ['B', 6]]))).toEqual([{ productId: 'A', buyPrice: 5, npcPrice: 8, profit: 3 }]);
  });
  it('computes seasonality ratios', () => {
    const s = seasonality([{ t: new Date('2026-12-01T00:00:00Z'), price: 50 }, { t: new Date('2026-12-01T12:00:00Z'), price: 150 }]);
    expect(s.byHour[0]).toBe(0.5);
    expect(s.byHour[12]).toBe(1.5);
    expect(s.byHour[3]).toBeNull();
  });
  it('builds a rebased index', () => {
    const idx = economyIndex(new Map([['A', [{ t: 1, price: 10 }, { t: 2, price: 20 }]], ['B', [{ t: 1, price: 5 }, { t: 2, price: 5 }]]]));
    expect(idx[0]!.value).toBeCloseTo(100);
    expect(idx[1]!.value).toBeCloseTo(100 * Math.SQRT2);
  });
  it('correlates moving series', () => {
    const a = Array.from({ length: 40 }, (_, i) => 100 + 10 * Math.sin(i));
    expect(correlation(a, a.map((x) => x * 2))).toBeCloseTo(1);
    expect(correlation(a.slice(0, 5), a.slice(0, 5))).toBeNull();
  });
  it('crafts when cheaper, recursively', () => {
    const recipes = new Map<string, Recipe>([
      ['BLOCK', { outputId: 'BLOCK', outputCount: 1, inputs: [{ id: 'ENCH', count: 2 }] }],
      ['ENCH', { outputId: 'ENCH', outputCount: 1, inputs: [{ id: 'RAW', count: 160 }] }],
    ]);
    const prices: Record<string, number> = { RAW: 1, ENCH: 200, BLOCK: 500 };
    const r = cheapest('BLOCK', (id) => prices[id] ?? null, recipes);
    expect(r.cost).toBe(320);
    expect(r.craft).toBe(true);
  });
  it('values a method and refuses to guess missing prices', () => {
    const spec = { unit: 'hour' as const, outputs: [{ item: 'A', qty: 10 }], inputs: [{ item: 'B', qty: 2 }], coins: 5 };
    expect(evaluateMethod(spec, (i) => ({ A: 100, B: 50 })[i] ?? null).value).toBe(905);
    expect(evaluateMethod(spec, (i) => (i === 'A' ? 100 : null)).value).toBeNull();
  });
});
