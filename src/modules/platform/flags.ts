import { createHash } from 'node:crypto';
import { atLeast, type Tier } from '../entitlements/tiers.js';

/** Deterministic rollout bucket 0-99 for an account and flag (stable across requests) */
export function bucket(key: string, accountId: string) {
  return createHash('sha256').update(`${key}:${accountId}`).digest().readUInt16BE(0) % 100;
}

export function flagOn(f: { key: string; enabled: boolean; minTier: string | null; rolloutPercent: number }, accountId: string | null, tier: Tier) {
  if (!f.enabled) return false;
  if (f.minTier && !atLeast(tier, f.minTier as Tier)) return false;
  if (f.rolloutPercent >= 100) return true;
  return accountId !== null && bucket(f.key, accountId) < f.rolloutPercent;
}
