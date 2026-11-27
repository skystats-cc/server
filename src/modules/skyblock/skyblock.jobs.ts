import type PgBoss from 'pg-boss';
import type { QueueDef } from '../../jobs/queue.js';
import { logger } from '../../lib/logger.js';
import { SKYBLOCK_QUEUES } from './skyblock.queues.js';
import { skyblockService } from './skyblock.service.js';

// 'stately': at most one queued + one active job per player (singletonKey = uuid)
export const queues: QueueDef[] = [
  { name: SKYBLOCK_QUEUES.refreshPlayer, policy: 'stately' },
  { name: SKYBLOCK_QUEUES.lookupName, policy: 'stately' },
  SKYBLOCK_QUEUES.refreshActive,
];

export async function registerWorkers(boss: PgBoss) {
  await boss.work<{ uuid: string }>(SKYBLOCK_QUEUES.refreshPlayer, async (jobs) => {
    for (const job of jobs) await skyblockService.refreshPlayer(job.data.uuid);
  });

  await boss.work<{ uuid: string }>(SKYBLOCK_QUEUES.lookupName, async (jobs) => {
    for (const job of jobs) await skyblockService.lookupName(job.data.uuid);
  });

  await boss.work(SKYBLOCK_QUEUES.refreshActive, async () => {
    const n = await skyblockService.refreshActive();
    if (n) logger.info({ queued: n }, 'refreshing active players');
  });
  await boss.schedule(SKYBLOCK_QUEUES.refreshActive, '*/10 * * * *');
}
