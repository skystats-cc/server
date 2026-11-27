import type PgBoss from 'pg-boss';
import type { QueueDef } from '../../jobs/queue.js';
import { SKYBLOCK_QUEUES } from './skyblock.queues.js';
import { skyblockService } from './skyblock.service.js';

// 'stately': at most one queued + one active job per player (singletonKey = uuid)
export const queues: QueueDef[] = [
  { name: SKYBLOCK_QUEUES.refreshPlayer, policy: 'stately' },
  { name: SKYBLOCK_QUEUES.lookupName, policy: 'stately' },
];
// There is deliberately no cron that polls active players. Hypixel's API policy forbids
// continuous polling of player data to build histories; money history comes from the mod.

export async function registerWorkers(boss: PgBoss) {
  await boss.work<{ uuid: string }>(SKYBLOCK_QUEUES.refreshPlayer, async (jobs) => {
    for (const job of jobs) await skyblockService.refreshPlayer(job.data.uuid);
  });

  await boss.work<{ uuid: string }>(SKYBLOCK_QUEUES.lookupName, async (jobs) => {
    for (const job of jobs) await skyblockService.lookupName(job.data.uuid);
  });

  // Remove the schedule left behind by earlier versions that polled active players.
  await boss.unschedule(SKYBLOCK_QUEUES.refreshActiveLegacy).catch(() => {});
}
