import { ForbiddenError } from '../../lib/errors.js';
import { entitlementsRepo } from './entitlements.repo.js';
import { effectiveTier, FEATURES, featuresFor, hasFeature, TIERS, type Feature, type Tier } from './tiers.js';

export const entitlementsService = {
  async tierOf(accountId: string | null | undefined): Promise<Tier> {
    if (!accountId) return 'free';
    return effectiveTier(await entitlementsRepo.get(accountId));
  },

  async require(accountId: string, feature: Feature) {
    const tier = await this.tierOf(accountId);
    if (!hasFeature(tier, feature)) {
      const min = FEATURES[feature];
      throw new ForbiddenError('upgrade_required', `This needs SkyStats ${min[0]!.toUpperCase()}${min.slice(1)} or above`);
    }
    return tier;
  },

  async describe(accountId: string) {
    const e = await entitlementsRepo.get(accountId);
    const tier = effectiveTier(e);
    return {
      tier,
      status: e?.status ?? 'none',
      currentPeriodEnd: e?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: e?.cancelAtPeriodEnd ?? false,
      graceUntil: e?.graceUntil ?? null,
      retentionDays: TIERS[tier].retentionDays,
      features: featuresFor(tier),
    };
  },
};
