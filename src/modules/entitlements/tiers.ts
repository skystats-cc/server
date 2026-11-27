// Pure tier rules, shared by every module. No DB, no HTTP: easy to test.

export const TIER_ORDER = ['free', 'pro', 'max'] as const;
export type Tier = (typeof TIER_ORDER)[number];

export const TIERS: Record<Tier, { retentionDays: number | null; priceGbpMonthly: number }> = {
  free: { retentionDays: 7, priceGbpMonthly: 0 },
  pro: { retentionDays: 90, priceGbpMonthly: 4.99 },
  max: { retentionDays: null, priceGbpMonthly: 12.99 }, // null = unlimited
};

/**
 * Minimum tier per feature. Alerts and DMs are Pro and above, except outage and patch
 * notices, which stay free for everyone.
 */
export const FEATURES = {
  'alerts.price': 'pro',
  'alerts.anomaly': 'pro',
  'alerts.manipulation': 'pro',
  'alerts.coop_activity': 'pro',
  'alerts.daily_digest': 'pro',
  'alerts.weekly_recap': 'pro',
  'alerts.goal_reached': 'pro',
  'alerts.mayor_reminder': 'pro',
  'alerts.quiet_hours': 'pro',
  'alerts.hypixel_outage': 'free',
  'alerts.skyblock_patch': 'free',
  'data.export_csv': 'free', // UK GDPR right of access/portability: never paywalled
  'mmm.advanced': 'pro',
  'mmm.custom': 'max',
  'mmm.beta': 'max',
  'api.public_keys': 'max',
} as const satisfies Record<string, Tier>;
export type Feature = keyof typeof FEATURES;

export const atLeast = (tier: Tier, min: Tier) => TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(min);
export const hasFeature = (tier: Tier, feature: Feature) => atLeast(tier, FEATURES[feature]);
export const featuresFor = (tier: Tier) => (Object.keys(FEATURES) as Feature[]).filter((f) => hasFeature(tier, f));

export interface EntitlementState {
  tier: string;
  status: string; // none | trialing | active | past_due | canceled | ...
  currentPeriodEnd: Date | null;
  graceUntil: Date | null;
}

/** The tier the account can use right now, given its billing state. */
export function effectiveTier(e: EntitlementState | null, now = new Date()): Tier {
  if (!e || !(TIER_ORDER as readonly string[]).includes(e.tier) || e.tier === 'free') return 'free';
  const tier = e.tier as Tier;
  if (e.status === 'active' || e.status === 'trialing') return tier;
  // Failed payment: keep paid features through the grace period
  if (e.status === 'past_due' && e.graceUntil && e.graceUntil > now) return tier;
  // Cancelled but already paid for: keep it until the period ends
  if (e.status === 'canceled' && e.currentPeriodEnd && e.currentPeriodEnd > now) return tier;
  return 'free';
}

const DAY = 86_400_000;

/** Oldest moment of history this tier may see (null = everything). */
export function visibleFrom(tier: Tier, now = new Date()): Date | null {
  const days = TIERS[tier].retentionDays;
  return days === null ? null : new Date(now.getTime() - days * DAY);
}

/**
 * Before this moment, history is deleted for good (null = delete nothing).
 * After a downgrade, data is only hidden for `softDays`, so resubscribing restores it.
 */
export function deleteBefore(tier: Tier, downgradedAt: Date | null, softDays: number, now = new Date()): Date | null {
  const from = visibleFrom(tier, now);
  if (!from) return null;
  if (downgradedAt && now.getTime() - downgradedAt.getTime() < softDays * DAY) return null;
  return from;
}
