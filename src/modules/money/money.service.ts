import { config } from '../../lib/config.js';
import { ConflictError } from '../../lib/errors.js';
import { normalizeUuid } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import { accountsService } from '../accounts/accounts.service.js';
import { alertsService } from '../alerts/alerts.service.js';
import { insightRepo } from '../insight/insight.repo.js';
import { insightService } from '../insight/insight.service.js';
import { entitlementsService } from '../entitlements/entitlements.service.js';
import { deleteBefore, effectiveTier, TIERS, visibleFrom } from '../entitlements/tiers.js';
import { skyblockService } from '../skyblock/skyblock.service.js';
import { moneyRepo } from './money.repo.js';

export const RANGES = { '1d': 1, '7d': 7, '30d': 30, '90d': 90, '1y': 365, all: null } as const;
export type Range = keyof typeof RANGES;
const DAY = 86_400_000;
const RAW_UP_TO_DAYS = 7;

export const moneyService = {
  /**
   * Mod → server: the player's own client reports their own coins. This is the only source of
   * money history (Hypixel's API policy forbids building it by polling the Public API).
   */
  async reportFromMod(
    accountId: string,
    input: {
      profileId: string;
      purse: number;
      personalBank?: number | null;
      profileBank?: number | null;
      skyblockXp?: number | null;
      inventory?: { id: string; count: number }[];
    },
  ) {
    const account = await accountsService.get(accountId);
    if (!account.trackingEnabled) throw new ConflictError('tracking_disabled', 'Tracking is turned off for this account');

    const profileId = normalizeUuid(input.profileId);
    if (!(await moneyRepo.isMember(account.uuid, profileId))) {
      // A profile we haven't seen: look it up once (cached, on demand) and ask the mod to retry later.
      void skyblockService.requestRefresh(account.uuid).catch((err) => logger.warn({ err }, 'refresh enqueue failed'));
      return { stored: false, reason: 'unknown_profile' as const };
    }
    const coins = { purse: input.purse, personalBank: input.personalBank ?? null, profileBank: input.profileBank ?? null, skyblockXp: input.skyblockXp ?? null };
    const stored = await moneyRepo.snapshotIfDue(
      {
        profileId,
        playerUuid: account.uuid,
        ...coins,
        inventoryValue: await insightService.inventoryValue(input.inventory),
        kind: await insightService.kindOf(account.uuid, profileId, coins),
      },
      config.MEMBER_SNAPSHOT_MIN_MINUTES,
    );
    if (stored) {
      const total = input.purse + (input.personalBank ?? 0) + (input.profileBank ?? 0);
      void alertsService.checkGoals(accountId, profileId, total).catch((err) => logger.warn({ err }, 'goal check failed'));
      void insightService.onSnapshot(accountId, profileId, total).catch((err) => logger.warn({ err }, 'session update failed'));
    }
    return { stored, reason: stored ? undefined : ('too_soon' as const) };
  },

  /** Money history for the signed-in player, clipped to what their tier may see. */
  async history(accountId: string, playerUuid: string, profileId: string, range: Range) {
    const tier = await entitlementsService.tierOf(accountId);
    const now = new Date();
    const days = RANGES[range];
    const wanted = days === null ? null : new Date(now.getTime() - days * DAY);
    const allowed = visibleFrom(tier, now);
    const from = [wanted, allowed].filter((d): d is Date => d !== null).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const clipped = allowed !== null && (wanted === null || wanted < allowed);
    const pid = normalizeUuid(profileId);

    const base = { tier, range, from, retentionDays: TIERS[tier].retentionDays, clippedByTier: clipped };
    if (days !== null && days <= RAW_UP_TO_DAYS) {
      const points = await moneyRepo.points(playerUuid, pid, from);
      return { ...base, resolution: 'raw' as const, points: points.map((p) => ({ ...p, total: Number(p.total) })) };
    }
    const rows = await moneyRepo.daily(playerUuid, pid, from ? from.toISOString().slice(0, 10) : null);
    return {
      ...base,
      resolution: 'daily' as const,
      points: rows.map((r) => ({ t: r.day, open: r.openTotal, total: r.closeTotal, min: r.minTotal, max: r.maxTotal })),
    };
  },

  /** Worker: daily rollups for the last two days */
  rollup: () => moneyRepo.rollupSince(new Date(Date.now() - 2 * DAY)),
  rollupBackfill: (days: number) => moneyRepo.rollupSince(new Date(Date.now() - days * DAY)),

  /** Worker: delete history older than each account's tier allows (after the soft window). */
  async enforceRetention() {
    const now = new Date();
    let deleted = 0;
    const rows = await moneyRepo.accountsWithEntitlements();
    for (const r of rows) {
      const tier = effectiveTier(r.tier ? { tier: r.tier, status: r.status ?? 'none', currentPeriodEnd: r.currentPeriodEnd, graceUntil: r.graceUntil } : null, now);
      const before = deleteBefore(tier, r.downgradedAt ?? null, config.SOFT_RETENTION_DAYS, now);
      if (before) {
        deleted += await moneyRepo.deleteHistoryBefore(r.playerUuid, before);
        await insightRepo.deleteBefore(r.accountId, before);
      }
    }
    deleted += await moneyRepo.deleteOrphanHistory();
    return deleted;
  },
};
