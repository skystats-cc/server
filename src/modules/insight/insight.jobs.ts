import type PgBoss from 'pg-boss';
import { logger } from '../../lib/logger.js';
import { insightService } from './insight.service.js';

const CLASSIFY = 'insight.classify-sessions';
export const queues = [CLASSIFY];

export async function registerWorkers(boss: PgBoss) {
  await boss.work(CLASSIFY, async () => {
    const n = await insightService.classifySessions();
    if (n) logger.info({ n }, 'sessions classified');
  });
  await boss.schedule(CLASSIFY, '*/10 * * * *');
}
