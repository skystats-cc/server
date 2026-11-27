import type PgBoss from 'pg-boss';
import { logger } from '../../lib/logger.js';
import { PLAYER_QUEUES } from './players.queues.js';
import { playersRepo } from './players.repo.js';
import { playersService } from './players.service.js';

const STALE_AFTER_MS = 15 * 60_000;
const STALE_BATCH = 100;

export const queues = Object.values(PLAYER_QUEUES);

export async function registerWorkers(boss: PgBoss) {
  await boss.work<{ uuid: string }>(PLAYER_QUEUES.refresh, async (jobs) => {
    for (const job of jobs) {
      await playersService.refresh(job.data.uuid);
      logger.debug({ uuid: job.data.uuid }, 'player refreshed');
    }
  });

  // Every 5 minutes, queue refreshes for players whose data is older than 15 minutes.
  await boss.work(PLAYER_QUEUES.refreshStale, async () => {
    const stale = await playersRepo.findStale(new Date(Date.now() - STALE_AFTER_MS), STALE_BATCH);
    for (const { uuid } of stale) await playersService.requestRefresh(uuid);
    logger.info({ count: stale.length }, 'queued stale player refreshes');
  });
  await boss.schedule(PLAYER_QUEUES.refreshStale, '*/5 * * * *');
}
