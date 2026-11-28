import type PgBoss from 'pg-boss';
import type { QueueDef } from '../../jobs/queue.js';
import { PLATFORM_QUEUES, platformService } from './platform.service.js';

export const queues: QueueDef[] = Object.values(PLATFORM_QUEUES);

export async function registerWorkers(boss: PgBoss) {
  await boss.work<{ webhookId: string; event: Record<string, unknown> }>(PLATFORM_QUEUES.webhook, { batchSize: 5 }, async (jobs) => {
    for (const j of jobs) await platformService.deliver(j.data.webhookId, j.data.event);
  });
  await boss.work(PLATFORM_QUEUES.jobHealth, async () => {
    await platformService.checkJobs();
  });
  await boss.schedule(PLATFORM_QUEUES.jobHealth, '*/10 * * * *');
}
