import type PgBoss from 'pg-boss';
import { every } from '../../jobs/loop.js';
import { config } from '../../lib/config.js';
import { BAZAAR_QUEUES } from './bazaar.queues.js';
import { bazaarService } from './bazaar.service.js';

export const queues = Object.values(BAZAAR_QUEUES);

export async function registerWorkers(boss: PgBoss) {
  // Realtime view: refresh latest prices every BAZAAR_POLL_SECONDS
  every('bazaar.poll', config.BAZAAR_POLL_SECONDS * 1000, () => bazaarService.pollLatest());

  // History: snapshot all products on a cron (default every 2h)
  await boss.work(BAZAAR_QUEUES.snapshot, async () => {
    await bazaarService.snapshot();
  });
  await boss.schedule(BAZAAR_QUEUES.snapshot, config.BAZAAR_SNAPSHOT_CRON);
}
