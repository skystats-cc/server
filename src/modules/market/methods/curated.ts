import type { MethodSpec } from '../analytics.js';
import type { Tier } from '../../entitlements/tiers.js';

/**
 * Curated money-making methods. Each is a module: add one object per method.
 * Only add rates the team has verified in game, and say where they came from in `source`.
 * Values are always computed from live prices, never stored.
 *
 * Template:
 * {
 *   id: 'example-farm',               // stable, kebab-case
 *   name: 'Example farm',
 *   category: 'farming',              // farming | mining | combat | fishing | foraging | crafting | other
 *   tier: 'free',                     // free = basic, pro = advanced, max = custom/beta
 *   beta: false,                      // true = Max only while being tested
 *   source: 'Measured by <name>, 2026-12-01, 3 x 1h sessions',
 *   spec: {
 *     unit: 'hour',
 *     outputs: [{ item: 'ENCHANTED_SUGAR_CANE', qty: 0, source: 'instasell' }],
 *     inputs: [],
 *     coins: 0,
 *     requirements: ['Farming 25', 'Garden level 5'],
 *   },
 * }
 */
export interface CuratedMethod {
  id: string;
  name: string;
  category: string;
  tier: Tier;
  beta: boolean;
  source: string;
  spec: MethodSpec;
}

export const CURATED_METHODS: CuratedMethod[] = [];
