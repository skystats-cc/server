import { NotFoundError } from '../../lib/errors.js';
import { skyblockLevel } from '../skyblock/skyblock.parse.js';
import { playersRepo } from './players.repo.js';

const DAY = 86_400_000;

export const playersService = {
  /** Built only from data the player chose to share. Never calls Hypixel (no tracking of strangers). */
  async publicSummary(name: string) {
    const p = await playersRepo.publicByName(name);
    if (!p || !p.username) throw new NotFoundError('public player');
    const showCoins = !p.hideBank && p.trackingEnabled;
    const fromDay = new Date(Date.now() - 7 * DAY).toISOString().slice(0, 10);
    const profiles = await Promise.all(
      (await playersRepo.profiles(p.uuid)).map(async (pr) => ({
        id: pr.id,
        name: pr.name,
        gameMode: pr.gameMode,
        selected: pr.selected,
        skyblockLevel: skyblockLevel(pr.skyblockXp),
        total: showCoins ? await playersRepo.latestTotal(p.uuid, pr.id) : null,
        week: showCoins ? await playersRepo.week(p.uuid, pr.id, fromDay) : [],
      })),
    );
    return {
      uuid: p.uuid,
      username: p.username,
      usesMod: p.modLastSeenAt !== null && Date.now() - p.modLastSeenAt.getTime() < 30 * DAY,
      profiles: profiles.sort((a, b) => Number(b.selected) - Number(a.selected)),
    };
  },
};
