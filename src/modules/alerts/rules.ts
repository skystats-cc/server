// Pure alert logic. No DB, no HTTP.

export type Op = 'above' | 'below';

export function priceCondition(op: Op, threshold: number, price: number) {
  return op === 'above' ? price >= threshold : price <= threshold;
}

/**
 * Hysteresis: a rule fires once when its condition becomes true, then waits until the condition
 * clears (re-arms) and the cooldown has passed before it can fire again. No spam while a price hovers.
 */
export function stepRule(
  rule: { armed: boolean; lastFiredAt: Date | null; cooldownMinutes: number },
  conditionTrue: boolean,
  now = new Date(),
): { fire: boolean; armed: boolean } {
  if (!conditionTrue) return { fire: false, armed: true };
  const cooled = !rule.lastFiredAt || now.getTime() - rule.lastFiredAt.getTime() >= rule.cooldownMinutes * 60_000;
  if (rule.armed && cooled) return { fire: true, armed: false };
  return { fire: false, armed: rule.armed && !cooled ? true : false };
}

export function median(xs: number[]) {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Robust z-score of the current price against recent history, on log prices so a 2x move
 * means the same for cheap and expensive items. Uses median and MAD, so one past spike
 * doesn't hide the next. Null when there's too little history.
 */
export function robustZ(history: number[], current: number): number | null {
  const logs = history.filter((p) => p > 0).map(Math.log);
  if (logs.length < 12 || current <= 0) return null;
  const med = median(logs);
  const mad = median(logs.map((l) => Math.abs(l - med))) * 1.4826;
  if (!(mad > 1e-9)) return null;
  return (Math.log(current) - med) / mad;
}

/**
 * Possible manipulation: a sudden wall of orders or volume far above normal for this item.
 * Describes the market only; never names or guesses at players.
 */
export function manipulationSignal(
  history: { buyOrders: number; sellOrders: number; buyVolume: number; sellVolume: number }[],
  now: { buyOrders: number; sellOrders: number; buyVolume: number; sellVolume: number },
  factor = 5,
): string | null {
  if (history.length < 12) return null;
  const checks: [keyof typeof now, string][] = [
    ['sellVolume', 'sell-offer volume'],
    ['buyVolume', 'buy-order volume'],
    ['sellOrders', 'number of sell offers'],
    ['buyOrders', 'number of buy orders'],
  ];
  for (const [k, label] of checks) {
    const base = median(history.map((h) => h[k]));
    if (base > 0 && now[k] >= base * factor) return `${label} is ${Math.round(now[k] / base)}× its usual level`;
  }
  return null;
}

/** Minutes after local midnight in a time zone */
export function localMinutes(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value);
  const m = Number(parts.find((p) => p.type === 'minute')?.value);
  return h * 60 + m;
}

/** When a notification may be delivered, given quiet hours (start may be after end: overnight). */
export function deliverAfter(now: Date, quiet: { start: number | null; end: number | null; timeZone: string }): Date {
  if (quiet.start === null || quiet.end === null || quiet.start === quiet.end) return now;
  const cur = localMinutes(now, quiet.timeZone);
  const inQuiet = quiet.start < quiet.end ? cur >= quiet.start && cur < quiet.end : cur >= quiet.start || cur < quiet.end;
  if (!inQuiet) return now;
  const wait = (quiet.end - cur + 1440) % 1440;
  return new Date(now.getTime() + wait * 60_000);
}
