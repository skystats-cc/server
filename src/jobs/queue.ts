import PgBoss from 'pg-boss';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';

// pg-boss stores jobs in Postgres, so no Redis needed yet.
export const boss = new PgBoss({ connectionString: config.DATABASE_URL });
boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));

export async function startBoss(queues: string[]) {
  await boss.start();
  for (const name of queues) {
    if (!(await boss.getQueue(name))) await boss.createQueue(name);
  }
}
