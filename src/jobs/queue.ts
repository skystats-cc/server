import PgBoss from 'pg-boss';
import { config } from '../lib/config.js';
import { logger } from '../lib/logger.js';

// pg-boss stores jobs in Postgres, so no Redis needed yet.
export const boss = new PgBoss({ connectionString: config.DATABASE_URL });
boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));

export type QueueDef = string | { name: string; policy?: PgBoss.QueuePolicy };

export async function startBoss(queues: QueueDef[]) {
  await boss.start();
  for (const q of queues) {
    const def = typeof q === 'string' ? { name: q } : q;
    if (!(await boss.getQueue(def.name))) await boss.createQueue(def.name, def);
  }
}
