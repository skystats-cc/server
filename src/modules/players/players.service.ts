import { fetchPlayer } from '../../ingest/client.js';
import { boss } from '../../jobs/queue.js';
import { NotFoundError } from '../../lib/errors.js';
import { PLAYER_QUEUES } from './players.queues.js';
import { playersRepo } from './players.repo.js';

// Business logic. Called by routes and jobs; never touches HTTP or SQL directly.
export const playersService = {
  async getPlayer(uuid: string) {
    const player = await playersRepo.findByUuid(uuid);
    if (!player) {
      // Unknown player: start tracking them so the next request has data.
      await this.requestRefresh(uuid);
      throw new NotFoundError('player (queued for fetch, try again shortly)');
    }
    const snapshot = await playersRepo.latestSnapshot(uuid);
    return {
      uuid: player.uuid,
      username: player.username,
      lastFetchedAt: player.lastFetchedAt,
      stats: snapshot?.data ?? null,
    };
  },

  async getHistory(uuid: string, limit: number) {
    if (!(await playersRepo.findByUuid(uuid))) throw new NotFoundError('player');
    return playersRepo.snapshots(uuid, limit);
  },

  async requestRefresh(uuid: string) {
    await boss.send(PLAYER_QUEUES.refresh, { uuid }, { singletonKey: uuid });
  },

  async refresh(uuid: string) {
    const upstream = await fetchPlayer(uuid);
    await playersRepo.upsertWithSnapshot({
      uuid: upstream.uuid,
      username: upstream.username,
      data: upstream,
    });
  },
};
