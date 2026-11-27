// Pure logic for mod-powered insight. No DB, no HTTP.

export interface Coins {
  purse: number | null;
  personalBank: number | null;
  profileBank: number | null;
  skyblockXp?: number | null;
}
const n = (x: number | null | undefined) => x ?? 0;
export const total = (c: Coins) => n(c.purse) + n(c.personalBank) + n(c.profileBank);

/**
 * What happened between two snapshots. A purse drop matched by a bank rise (within 1%) is a
 * transfer, not spending. A near-total wipe with lower SkyBlock XP is a profile reset.
 */
export function classifyDelta(prev: Coins, cur: Coins): { kind: 'normal' | 'transfer' | 'reset'; income: number; spending: number } {
  const before = total(prev);
  const after = total(cur);
  if (before > 1_000_000 && after < before * 0.05 && n(cur.skyblockXp) < n(prev.skyblockXp)) return { kind: 'reset', income: 0, spending: 0 };
  const dPurse = n(cur.purse) - n(prev.purse);
  const dBank = n(cur.personalBank) + n(cur.profileBank) - n(prev.personalBank) - n(prev.profileBank);
  const moved = Math.min(Math.abs(dPurse), Math.abs(dBank));
  const isTransfer = Math.sign(dPurse) === -Math.sign(dBank) && moved > 0 && Math.abs(Math.abs(dPurse) - Math.abs(dBank)) <= Math.max(Math.abs(dPurse), Math.abs(dBank)) * 0.01;
  const net = after - before;
  if (isTransfer && Math.abs(net) <= moved * 0.01 + 1) return { kind: 'transfer', income: 0, spending: 0 };
  return { kind: 'normal', income: Math.max(0, net), spending: Math.max(0, -net) };
}

export const MILESTONES = [1e6, 1e7, 1e8, 1e9, 1e10] as const;

/** First day the closing total reached each milestone */
export function milestones(days: { day: string; close: number | null }[]) {
  const out: { amount: number; day: string }[] = [];
  for (const m of MILESTONES) {
    const hit = days.find((d) => (d.close ?? 0) >= m);
    if (hit) out.push({ amount: m, day: hit.day });
  }
  return out;
}

/** The main activity in a session from item categories of what was collected. Null if unclear. */
export function classifyActivity(categories: (string | null)[]): string | null {
  const map: Record<string, string> = {
    farming: 'farming', farm: 'farming', mining: 'mining', mine: 'mining', combat: 'combat', fishing: 'fishing', foraging: 'foraging', slayer: 'combat', dungeon: 'dungeons',
  };
  const counts = new Map<string, number>();
  for (const c of categories) {
    if (!c) continue;
    const k = map[c.toLowerCase()] ?? Object.entries(map).find(([key]) => c.toLowerCase().includes(key))?.[1];
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  if (!sorted[0]) return null;
  const all = [...counts.values()].reduce((s, x) => s + x, 0);
  return sorted[0][1] / all > 0.5 ? sorted[0][0] : null;
}

/** Coins per hour for a session; null under 5 minutes (too noisy) */
export function coinsPerHour(start: number | null, end: number | null, ms: number) {
  if (start === null || end === null || ms < 5 * 60_000) return null;
  return (end - start) / (ms / 3_600_000);
}
