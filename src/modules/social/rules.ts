// Pure rules for leaderboards, achievements, games and Wrapped.

export const ACHIEVEMENTS = {
  first_million: { name: 'First million', description: 'Reached 1M coins' },
  first_billion: { name: 'Billionaire', description: 'Reached 1B coins' },
  ten_billion: { name: 'Ten billion', description: 'Reached 10B coins' },
  sessions_10: { name: 'Regular', description: '10 play sessions' },
  sessions_100: { name: 'Dedicated', description: '100 play sessions' },
  streak_7: { name: 'Week streak', description: 'Gained coins 7 days in a row' },
  streak_30: { name: 'Month streak', description: 'Gained coins 30 days in a row' },
  early_adopter: { name: 'Early adopter', description: 'Joined SkyStats in its first year' },
  supporter: { name: 'Supporter', description: 'Supports SkyStats with a paid plan' },
} as const;
export type AchievementKey = keyof typeof ACHIEVEMENTS;

export const EARLY_ADOPTER_BEFORE = new Date('2027-12-01T00:00:00Z');

/** Longest run of consecutive days with a positive change (days sorted ascending, YYYY-MM-DD) */
export function longestStreak(days: { day: string; change: number | null }[]) {
  let best = 0;
  let cur = 0;
  let prev: number | null = null;
  for (const d of days) {
    const t = Date.parse(d.day);
    const consecutive = prev !== null && t - prev === 86_400_000;
    if ((d.change ?? 0) > 0) cur = consecutive ? cur + 1 : 1;
    else cur = 0;
    best = Math.max(best, cur);
    prev = t;
  }
  return best;
}

export function earnedAchievements(input: {
  maxTotal: number;
  sessions: number;
  longestStreak: number;
  createdAt: Date;
  paid: boolean;
}): AchievementKey[] {
  const out: AchievementKey[] = [];
  if (input.maxTotal >= 1e6) out.push('first_million');
  if (input.maxTotal >= 1e9) out.push('first_billion');
  if (input.maxTotal >= 1e10) out.push('ten_billion');
  if (input.sessions >= 10) out.push('sessions_10');
  if (input.sessions >= 100) out.push('sessions_100');
  if (input.longestStreak >= 7) out.push('streak_7');
  if (input.longestStreak >= 30) out.push('streak_30');
  if (input.createdAt < EARLY_ADOPTER_BEFORE) out.push('early_adopter');
  if (input.paid) out.push('supporter');
  return out;
}

/** Guess-the-price: 100 points for exact, falling to 0 at 50% off (log scale) */
export function guessPoints(guess: number, actual: number) {
  if (guess <= 0 || actual <= 0) return 0;
  const err = Math.abs(Math.log(guess / actual));
  return Math.max(0, Math.round(100 * (1 - err / Math.log(1.5))));
}

/** Up/down prediction: 10 points if right, 0 if wrong or flat */
export function predictionPoints(direction: number, start: number, end: number) {
  const moved = end > start ? 1 : end < start ? -1 : 0;
  return moved !== 0 && moved === Math.sign(direction) ? 10 : 0;
}

/** Deterministic daily pick from a list (same for everyone that day) */
export function pickForDay(ids: string[], day: string, salt: string) {
  let h = 2166136261;
  for (const c of `${salt}:${day}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ids.length ? ids[Math.abs(h) % ids.length]! : null;
}

/** Days with a gain divided by days with data (0-1) */
export function consistency(days: { change: number | null }[]) {
  const withData = days.filter((d) => d.change !== null);
  return withData.length ? withData.filter((d) => d.change! > 0).length / withData.length : 0;
}
