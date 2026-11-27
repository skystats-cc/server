// Pure market maths. Prices: buyPrice = instabuy (lowest sell offer), sellPrice = instasell (highest buy order).

export interface Quote {
  productId: string;
  buyPrice: number;
  sellPrice: number;
  buyMovingWeek: number;
  sellMovingWeek: number;
}

/**
 * Order flips: place a buy order just above the best bid, sell offer just below the best ask.
 * `potentialPerHour` assumes you fill `share` of the item's hourly volume; it's an upper-bound
 * illustration, not a promise, and the UI labels it so.
 */
export function flips(quotes: Quote[], tax: number, share = 0.01) {
  return quotes
    .map((q) => {
      const buyAt = q.sellPrice + 0.1;
      const sellAt = q.buyPrice - 0.1;
      const margin = sellAt * (1 - tax) - buyAt;
      const hourlyVolume = Math.min(q.buyMovingWeek, q.sellMovingWeek) / 168;
      return { productId: q.productId, buyAt, sellAt, margin, marginPct: buyAt > 0 ? margin / buyAt : 0, hourlyVolume, potentialPerHour: margin * hourlyVolume * share };
    })
    .filter((f) => f.margin > 0 && f.hourlyVolume >= 1)
    .sort((a, b) => b.potentialPerHour - a.potentialPerHour);
}

/** Items you can instabuy for less than an NPC pays */
export function npcArbitrage(quotes: Quote[], npc: Map<string, number>) {
  return quotes
    .map((q) => ({ productId: q.productId, buyPrice: q.buyPrice, npcPrice: npc.get(q.productId) ?? 0 }))
    .filter((r) => r.npcPrice > 0 && r.buyPrice > 0 && r.buyPrice < r.npcPrice)
    .map((r) => ({ ...r, profit: r.npcPrice - r.buyPrice }))
    .sort((a, b) => b.profit - a.profit);
}

/** Average price by UTC hour and by weekday, as a ratio of the overall mean (1 = average) */
export function seasonality(points: { t: Date; price: number }[]) {
  const mean = points.reduce((s, p) => s + p.price, 0) / (points.length || 1);
  const agg = (key: (d: Date) => number, n: number) => {
    const sum = Array<number>(n).fill(0);
    const cnt = Array<number>(n).fill(0);
    for (const p of points) {
      const k = key(p.t);
      sum[k]! += p.price;
      cnt[k]!++;
    }
    return sum.map((s, i) => (cnt[i] ? s / cnt[i]! / mean : null));
  };
  return { byHour: agg((d) => d.getUTCHours(), 24), byWeekday: agg((d) => d.getUTCDay(), 7) };
}

/** Equal-weight economy index: geometric mean of price relatives, rebased to 100 at the first point */
export function economyIndex(series: Map<string, { t: number; price: number }[]>) {
  const base = new Map<string, number>();
  const byTime = new Map<number, number[]>();
  for (const [id, pts] of series) {
    for (const p of pts) {
      if (p.price <= 0) continue;
      if (!base.has(id)) base.set(id, p.price);
      byTime.set(p.t, [...(byTime.get(p.t) ?? []), Math.log(p.price / base.get(id)!)]);
    }
  }
  return [...byTime.entries()]
    .sort((a, b) => a[0] - b[0])
    .filter(([, logs]) => logs.length >= Math.max(1, Math.floor(series.size * 0.8)))
    .map(([t, logs]) => ({ t, value: 100 * Math.exp(logs.reduce((s, l) => s + l, 0) / logs.length) }));
}

/** Pearson correlation of log returns over aligned points; null if too few */
export function correlation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  const ra: number[] = [];
  const rb: number[] = [];
  for (let i = 1; i < n; i++) {
    if (a[i]! > 0 && a[i - 1]! > 0 && b[i]! > 0 && b[i - 1]! > 0) {
      ra.push(Math.log(a[i]! / a[i - 1]!));
      rb.push(Math.log(b[i]! / b[i - 1]!));
    }
  }
  if (ra.length < 20) return null;
  const ma = ra.reduce((s, x) => s + x, 0) / ra.length;
  const mb = rb.reduce((s, x) => s + x, 0) / rb.length;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i]! - ma) * (rb[i]! - mb);
    da += (ra[i]! - ma) ** 2;
    db += (rb[i]! - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : null;
}

export interface Recipe {
  outputId: string;
  outputCount: number;
  inputs: { id: string; count: number }[];
}

/**
 * Cheapest way to get one unit: buy it, or craft it from the cheapest inputs (recursively).
 * Returns the cost and the plan used. Depth-limited to stop cycles.
 */
export function cheapest(
  id: string,
  buy: (id: string) => number | null,
  recipes: Map<string, Recipe>,
  depth = 0,
): { cost: number | null; craft: boolean; parts?: { id: string; count: number; cost: number | null; craft: boolean }[] } {
  const direct = buy(id);
  const r = recipes.get(id);
  if (!r || depth >= 4) return { cost: direct, craft: false };
  const parts = r.inputs.map((inp) => {
    const sub = cheapest(inp.id, buy, recipes, depth + 1);
    return { id: inp.id, count: inp.count, cost: sub.cost === null ? null : (sub.cost * inp.count) / r.outputCount, craft: sub.craft };
  });
  const craftCost = parts.some((p) => p.cost === null) ? null : parts.reduce((s, p) => s + p.cost!, 0);
  if (craftCost !== null && (direct === null || craftCost < direct)) return { cost: craftCost, craft: true, parts };
  return { cost: direct, craft: false, parts };
}

// ---------------------------------------------------------------- methods

export type PriceSource = 'instasell' | 'instabuy' | 'npc' | 'bin';
export interface MethodSpec {
  unit: 'hour' | 'action';
  outputs: { item: string; qty: number; source?: PriceSource }[];
  inputs: { item: string; qty: number; source?: PriceSource }[];
  coins?: number; // flat coins per unit (e.g. NPC rewards)
  requirements?: string[];
}

/** Value of one unit of a method. Missing prices make the whole value unknown (never guessed). */
export function evaluateMethod(spec: MethodSpec, price: (item: string, source: PriceSource) => number | null) {
  const lines = [
    ...spec.outputs.map((o) => ({ ...o, side: 'out' as const, source: o.source ?? ('instasell' as const) })),
    ...spec.inputs.map((i) => ({ ...i, side: 'in' as const, source: i.source ?? ('instabuy' as const) })),
  ].map((l) => {
    const p = price(l.item, l.source);
    return { ...l, unitPrice: p, total: p === null ? null : p * l.qty * (l.side === 'out' ? 1 : -1) };
  });
  const value = lines.some((l) => l.total === null) ? null : lines.reduce((s, l) => s + l.total!, spec.coins ?? 0);
  return { value, lines };
}
