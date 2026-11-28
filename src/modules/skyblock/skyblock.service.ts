import { fetchSkyblockProfiles, hasHypixelKey } from '../../ingest/hypixel.js';
import { lookupProfile } from '../../ingest/mojang.js';
import { boss } from '../../jobs/queue.js';
import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';
import { accountsRepo } from '../accounts/accounts.repo.js';
import { parseProfiles, skyblockLevel } from './skyblock.parse.js';
import { SKYBLOCK_QUEUES } from './skyblock.queues.js';
import { skyblockRepo } from './skyblock.repo.js';

const NAME_MAX_AGE_MS = 7 * 86_400_000;
const USES_MOD_WITHIN_MS = 30 * 86_400_000;
let warnedNoKey = false;

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

export const skyblockService = {
  /**
   * Queue a Hypixel fetch for this player, unless it was fetched within PROFILE_REFRESH_MIN_MINUTES.
   * Cheap to call often (heartbeats, page views): the queue dedupes per player.
   */
  async requestRefresh(uuid: string, opts: { minMinutes?: number; priority?: number } = {}) {
    if (!hasHypixelKey()) {
      if (!warnedNoKey) logger.warn('HYPIXEL_API_KEY not set: SkyBlock profile refreshes are disabled');
      warnedNoKey = true;
      return false;
    }
    const player = await skyblockRepo.getPlayer(uuid);
    const minMinutes = opts.minMinutes ?? config.PROFILE_REFRESH_MIN_MINUTES;
    if (player?.profilesFetchedAt && player.profilesFetchedAt > minutesAgo(minMinutes)) return false;
    // Paid refreshes jump the queue (priority lane); everyone still gets refreshed
    await boss.send(SKYBLOCK_QUEUES.refreshPlayer, { uuid }, { singletonKey: uuid, priority: opts.priority ?? 0 });
    return true;
  },

  /**
   * Worker: fetch from Hypixel and store profiles + co-op members, then queue name lookups.
   * This is an on-demand, cached lookup (link, viewing /me, an unknown profile from the mod).
   * It never writes money history: that only comes from the player's own mod (see moneyService).
   */
  async refreshPlayer(uuid: string) {
    const player = await skyblockRepo.getPlayer(uuid);
    if (player?.profilesFetchedAt && player.profilesFetchedAt > minutesAgo(1)) return; // just done

    const profiles = parseProfiles(await fetchSkyblockProfiles(uuid));
    await skyblockRepo.saveProfiles(uuid, profiles);


    // Names only for people we actually show (active members)
    const shown = [...new Set(profiles.flatMap((p) => p.members.filter((m) => m.active).map((m) => m.uuid)))];
    for (const memberUuid of await skyblockRepo.needingNames(shown, new Date(Date.now() - NAME_MAX_AGE_MS))) {
      await boss.send(SKYBLOCK_QUEUES.lookupName, { uuid: memberUuid }, { singletonKey: memberUuid });
    }
    logger.info({ uuid, profiles: profiles.length }, 'skyblock profiles refreshed');
  },

  /** Worker: resolve a username via Mojang */
  async lookupName(uuid: string) {
    const profile = await lookupProfile(uuid);
    await skyblockRepo.setUsername(uuid, profile?.name ?? null);
  },


  /** API: the signed-in player's profiles, grouped with their co-op members */
  async myProfiles(uuid: string) {
    const player = await skyblockRepo.getPlayer(uuid);
    const { profiles, members } = await skyblockRepo.myProfiles(uuid);
    const now = Date.now();

    return {
      lastFetchedAt: player?.profilesFetchedAt ?? null,
      profiles: profiles
        .map((p) => {
          const ms = members
            .filter((m) => m.profileId === p.id)
            .map((m) => ({
              uuid: m.uuid,
              username: m.username,
              isYou: m.uuid === uuid,
              onSkyStats: m.accountId !== null,
              usesMod: m.modLastSeenAt !== null && now - m.modLastSeenAt.getTime() < USES_MOD_WITHIN_MS,
              trackingEnabled: m.accountId === null ? null : (m.trackingEnabled ?? true),
              firstJoin: m.firstJoin,
              // Co-op mates only see each other's coins when that member allows it
              purse: m.uuid === uuid || m.hideBank === false ? m.purse : null,
              personalBank: m.uuid === uuid || m.hideBank === false ? m.personalBank : null,
              skyblockLevel: skyblockLevel(m.skyblockXp),
            }))
            // you first, then by join date
            .sort((a, b) => Number(b.isYou) - Number(a.isYou) || (a.firstJoin?.getTime() ?? 0) - (b.firstJoin?.getTime() ?? 0));
          return {
            id: p.id,
            name: p.cuteName,
            gameMode: p.gameMode,
            selected: p.selected,
            coop: ms.length > 1,
            bank: p.bankBalance,
            members: ms,
            updatedAt: p.updatedAt,
          };
        })
        .sort((a, b) => Number(b.selected) - Number(a.selected) || (a.name ?? '').localeCompare(b.name ?? '')),
    };
  },
};
